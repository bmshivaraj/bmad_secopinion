import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "cases-route-test-secret";

const {
	parseCaseDocumentUploads,
	parseCaseClassificationRequest,
	parseCaseAssignmentRequest,
	parseCaseDraftRequest,
	parseCaseSubmissionRequest,
	parseDoctorSelectionRequest,
	requireDocumentReaderContext,
	requireDoctorContext,
	requirePatientContext,
} = await import("./routes");
const { GET: getDocumentRoute } = await import("../../app/api/cases/documents/[documentId]/route");
const { GET: getUnclassifiedCasesRoute } = await import("../../app/api/cases/unclassified/route");
const { GET: getAdminAssignmentCasesRoute } = await import("../../app/api/admin/cases/assignment/route");
const { POST: postAdminCaseAssignmentRoute } = await import("../../app/api/admin/cases/[caseId]/assignment/route");
const { PATCH: patchCaseSpecialtyRoute } = await import("../../app/api/cases/[caseId]/specialty/route");
const { GET: getDoctorQueueRoute } = await import("../../app/api/doctors/queue/route");
const { GET: getDoctorCaseRoute } = await import("../../app/api/doctors/queue/[caseId]/route");
const { POST: postDoctorClaimRoute } = await import("../../app/api/doctors/queue/[caseId]/claim/route");
const { GET: getDoctorDirectoryRoute } = await import("../../app/api/cases/doctors/route");
const { PATCH: patchDoctorSelectionRoute } = await import("../../app/api/cases/[caseId]/selection/route");
const { POST: postCaseSubmitRoute } = await import("../../app/api/cases/[caseId]/submit/route");
const { GET: getCaseFeesRoute } = await import("../../app/api/cases/fees/route");
const { casesService } = await import("./service");
const { CaseAccessDeniedError, CaseAssignmentVersionConflictError } = await import("./domain");
const { signAuthToken } = await import("../../shared/auth-context");

test("draft parser accepts the approved fields and rejects malformed JSON shapes", async () => {
	const request = new Request("http://localhost/api/cases/draft", {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ affectedBodyArea: "Back", condition: "Pain", recommendation: "Physiotherapy", additionalDetails: "", caseId: "case-a", creationRequestId: "123e4567-e89b-42d3-a456-426614174000" }),
	});
	assert.deepEqual(await parseCaseDraftRequest(request), {
		input: { affectedBodyArea: "Back", condition: "Pain", recommendation: "Physiotherapy", additionalDetails: "" },
		caseId: "case-a",
		creationRequestId: "123e4567-e89b-42d3-a456-426614174000",
	});
	await assert.rejects(parseCaseDraftRequest(new Request("http://localhost", { method: "PUT", body: "[]" })), { code: "VALIDATION_ERROR" });
	assert.equal(await parseDoctorSelectionRequest(new Request("http://localhost", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ selectedDoctorId: null }),
	})), null);
	await assert.rejects(parseDoctorSelectionRequest(new Request("http://localhost", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ selectedDoctorId: " " }),
	})), { code: "VALIDATION_ERROR" });
	assert.deepEqual(await parseCaseClassificationRequest(new Request("http://localhost", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ specialtyId: " specialty-cardio " }),
	})), { specialtyId: "specialty-cardio" });
	await assert.rejects(parseCaseClassificationRequest(new Request("http://localhost", {
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ specialtyId: " " }),
	})), { code: "VALIDATION_ERROR" });
	assert.deepEqual(await parseCaseAssignmentRequest(new Request("http://localhost", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ doctorId: " doctor-1 ", expectedVersion: 4 }),
	})), { doctorId: "doctor-1", expectedVersion: 4 });
	await assert.rejects(parseCaseAssignmentRequest(new Request("http://localhost", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ expectedVersion: -1 }),
	})), { code: "VALIDATION_ERROR" });
});

test("Admin assignment and Doctor claim routes enforce roles and return private envelopes", async () => {
	const originals = {
		listAdminAssignmentCases: casesService.listAdminAssignmentCases,
		assignCaseToDoctor: casesService.assignCaseToDoctor,
	};
	const assignments: { role: string; caseId: string; doctorId: string | undefined; expectedVersion: number }[] = [];
	casesService.listAdminAssignmentCases = async () => [{
		id: "case-assignable",
		affectedBodyArea: "Knee",
		condition: "Pain",
		recommendation: "Review",
		additionalDetails: "",
		specialtyId: "specialty-cardio",
		urgencyTier: "Urgent",
		status: "Submitted",
		doctorId: null,
		assignedDoctorName: null,
		availableDoctors: [{ id: "doctor-1", fullName: "Dr. One" }],
		submittedAt: "2026-10-22T12:00:00.000Z",
		assignmentLockVersion: 3,
	}];
	casesService.assignCaseToDoctor = async (caller, caseId, doctorId, expectedVersion) => {
		assignments.push({ role: caller.role, caseId, doctorId, expectedVersion });
		if (expectedVersion !== 3) throw new CaseAssignmentVersionConflictError();
		return { id: caseId, doctorId: doctorId ?? caller.userId, selectedDoctorId: null, status: "UnderReview", assignmentLockVersion: expectedVersion + 1, submittedAt: "2026-10-22T12:00:00.000Z" };
	};
	try {
		const adminToken = signAuthToken({ userId: "admin-1", role: "admin" });
		const doctorToken = signAuthToken({ userId: "doctor-1", role: "doctor" });
		const queue = await getAdminAssignmentCasesRoute(new Request("http://localhost/api/admin/cases/assignment", {
			headers: { cookie: `admin_session=${adminToken}` },
		}));
		assert.equal(queue.status, 200);
		assert.equal(queue.headers.get("cache-control"), "private, no-store");
		assert.equal((await queue.json() as { data: { id: string }[] }).data[0].id, "case-assignable");

		const adminAssignment = await postAdminCaseAssignmentRoute(new Request("http://localhost/api/admin/cases/case-assignable/assignment", {
			method: "POST",
			headers: { cookie: `admin_session=${adminToken}`, "content-type": "application/json" },
			body: JSON.stringify({ doctorId: "doctor-1", expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(adminAssignment.status, 200);
		assert.equal(adminAssignment.headers.get("cache-control"), "private, no-store");
		assert.deepEqual(assignments[0], { role: "admin", caseId: "case-assignable", doctorId: "doctor-1", expectedVersion: 3 });

		const claim = await postDoctorClaimRoute(new Request("http://localhost/api/doctors/queue/case-assignable/claim", {
			method: "POST",
			headers: { cookie: `doctor_session=${doctorToken}`, "content-type": "application/json" },
			body: JSON.stringify({ expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(claim.status, 200);
		assert.equal(claim.headers.get("cache-control"), "private, no-store");
		assert.deepEqual(assignments[1], { role: "doctor", caseId: "case-assignable", doctorId: undefined, expectedVersion: 3 });
		const wrongRoleClaim = await postDoctorClaimRoute(new Request("http://localhost/api/doctors/queue/case-assignable/claim", {
			method: "POST",
			headers: { cookie: `admin_session=${adminToken}`, "content-type": "application/json" },
			body: JSON.stringify({ expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(wrongRoleClaim.status, 401);
		const proxyClaim = await postDoctorClaimRoute(new Request("http://localhost/api/doctors/queue/case-assignable/claim", {
			method: "POST",
			headers: { cookie: `doctor_session=${doctorToken}`, "content-type": "application/json" },
			body: JSON.stringify({ doctorId: "doctor-2", expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(proxyClaim.status, 400);

		const unauthorized = await getAdminAssignmentCasesRoute(new Request("http://localhost/api/admin/cases/assignment"));
		assert.equal(unauthorized.status, 401);
		const wrongRole = await getAdminAssignmentCasesRoute(new Request("http://localhost/api/admin/cases/assignment", {
			headers: { cookie: `admin_session=${doctorToken}` },
		}));
		assert.equal(wrongRole.status, 403);
		const unauthenticatedAssignment = await postAdminCaseAssignmentRoute(new Request("http://localhost/api/admin/cases/case-assignable/assignment", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ doctorId: "doctor-1", expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(unauthenticatedAssignment.status, 401);
		const wrongRoleAssignment = await postAdminCaseAssignmentRoute(new Request("http://localhost/api/admin/cases/case-assignable/assignment", {
			method: "POST",
			headers: { cookie: `admin_session=${doctorToken}`, "content-type": "application/json" },
			body: JSON.stringify({ doctorId: "doctor-1", expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(wrongRoleAssignment.status, 403);
		const staleAssignment = await postAdminCaseAssignmentRoute(new Request("http://localhost/api/admin/cases/case-assignable/assignment", {
			method: "POST",
			headers: { cookie: `admin_session=${adminToken}`, "content-type": "application/json" },
			body: JSON.stringify({ doctorId: "doctor-1", expectedVersion: 2 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(staleAssignment.status, 409);
		assert.equal((await staleAssignment.json() as { error: { code: string } }).error.code, "CASE_ASSIGNMENT_VERSION_CONFLICT");
		const unauthenticatedClaim = await postDoctorClaimRoute(new Request("http://localhost/api/doctors/queue/case-assignable/claim", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ expectedVersion: 3 }),
		}), { params: Promise.resolve({ caseId: "case-assignable" }) });
		assert.equal(unauthenticatedClaim.status, 401);
	} finally {
		Object.assign(casesService, originals);
	}
});

test("classification and Doctor queue routes use role sessions and private envelopes", async () => {
	const originals = {
		listUnclassifiedSubmittedCases: casesService.listUnclassifiedSubmittedCases,
		classifySubmittedCase: casesService.classifySubmittedCase,
		listDoctorQueue: casesService.listDoctorQueue,
		getDoctorCase: casesService.getDoctorCase,
	};
	let classifiedBy = "";
	casesService.listUnclassifiedSubmittedCases = async () => [{
		id: "case-unclassified",
		affectedBodyArea: "Knee",
		condition: "Pain",
		recommendation: "Review",
		additionalDetails: "",
		urgencyTier: "Urgent",
		doctorId: null,
		assignedDoctorName: null,
		documents: [],
		submittedAt: "2026-10-22T12:00:00.000Z",
	}];
	casesService.classifySubmittedCase = async (caller, caseId, specialtyId) => {
		classifiedBy = caller.userId;
		return { id: caseId, specialtyId, doctorId: null, selectedDoctorId: null, submittedAt: "2026-10-22T12:00:00.000Z" };
	};
	casesService.listDoctorQueue = async () => [{
		id: "case-1",
		affectedBodyArea: "Knee",
		condition: "Pain",
		recommendation: "Review",
		additionalDetails: "",
		specialtyId: "specialty-cardio",
		urgencyTier: "Urgent",
		status: "Submitted",
		doctorId: null,
		assignmentLockVersion: 0,
		submittedAt: "2026-10-22T12:00:00.000Z",
		elapsedSlaMs: 1000,
		remainingSlaMs: 431999000,
	}];
	casesService.getDoctorCase = async () => ({
		id: "case-1",
		affectedBodyArea: "Knee",
		condition: "Pain",
		recommendation: "Review",
		additionalDetails: "",
		specialtyId: "specialty-cardio",
		urgencyTier: "Urgent",
		status: "Submitted",
		doctorId: "doctor-1",
		assignmentLockVersion: 0,
		submittedAt: "2026-10-22T12:00:00.000Z",
		elapsedSlaMs: 1000,
		remainingSlaMs: 431999000,
		documents: [],
	});
	try {
		const adminToken = signAuthToken({ userId: "admin-1", role: "admin" });
		const doctorToken = signAuthToken({ userId: "doctor-1", role: "doctor" });
		const unclassified = await getUnclassifiedCasesRoute(new Request("http://localhost/api/cases/unclassified", {
			headers: { cookie: `admin_session=${adminToken}` },
		}));
		assert.equal(unclassified.status, 200);
		assert.equal(unclassified.headers.get("cache-control"), "private, no-store");
		assert.equal((await unclassified.json() as { data: { id: string }[] }).data[0].id, "case-unclassified");

		const classification = await patchCaseSpecialtyRoute(new Request("http://localhost/api/cases/case-unclassified/specialty", {
			method: "PATCH",
			headers: { cookie: `admin_session=${adminToken}`, "content-type": "application/json" },
			body: JSON.stringify({ specialtyId: "specialty-cardio" }),
		}), { params: Promise.resolve({ caseId: "case-unclassified" }) });
		assert.equal(classification.status, 200);
		assert.equal(classifiedBy, "admin-1");
		assert.equal(classification.headers.get("cache-control"), "private, no-store");

		const queue = await getDoctorQueueRoute(new Request("http://localhost/api/doctors/queue", {
			headers: { cookie: `doctor_session=${doctorToken}` },
		}));
		assert.equal(queue.status, 200);
		assert.equal(queue.headers.get("cache-control"), "private, no-store");
		const queueData = (await queue.json() as { data: { id: string; assignmentLockVersion: number }[] }).data;
		assert.equal(queueData[0].id, "case-1");
		assert.equal(queueData[0].assignmentLockVersion, 0);
		const detail = await getDoctorCaseRoute(new Request("http://localhost/api/doctors/queue/case-1", {
			headers: { cookie: `doctor_session=${doctorToken}` },
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(detail.status, 200);
		assert.equal((await detail.json() as { data: { id: string } }).data.id, "case-1");

		const unauthorized = await getDoctorQueueRoute(new Request("http://localhost/api/doctors/queue"));
		assert.equal(unauthorized.status, 401);
		const patientToken = signAuthToken({ userId: "patient-1", role: "patient" });
		const nonAdmin = await patchCaseSpecialtyRoute(new Request("http://localhost/api/cases/case-1/specialty", {
			method: "PATCH",
			headers: { cookie: `admin_session=${patientToken}`, "content-type": "application/json" },
			body: JSON.stringify({ specialtyId: "specialty-cardio" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(nonAdmin.status, 403);
	} finally {
		Object.assign(casesService, originals);
	}
});

test("Doctor directory and draft selection routes require Patient auth and return private envelopes", async () => {
	const originalMethods = {
		listVerifiedDoctors: casesService.listVerifiedDoctors,
		saveDraftDoctorSelection: casesService.saveDraftDoctorSelection,
	};
	let savedSelection: string | null = null;
	let savedOwner = "";
	casesService.listVerifiedDoctors = async () => [{ id: "doctor-1", fullName: "Dr. Public", specialties: ["Cardiology"] }];
	casesService.saveDraftDoctorSelection = async (caller, caseId, selectedDoctorId) => {
		savedOwner = caller.userId;
		savedSelection = selectedDoctorId;
		const now = new Date();
		return {
			id: caseId,
			doctorId: null,
			affectedBodyArea: "Knee",
			condition: "Pain",
			recommendation: "Review",
			additionalDetails: "",
			selectedDoctorId,
			urgencyTier: null,
			chargedAmount: null,
			status: "Draft",
			documents: [],
			createdAt: now,
			updatedAt: now,
		};
	};

	try {
		const patientToken = signAuthToken({ userId: "patient-1", role: "patient" });
		const directoryResponse = await getDoctorDirectoryRoute(new Request("http://localhost/api/cases/doctors", {
			headers: { cookie: `patient_session=${patientToken}` },
		}));
		assert.equal(directoryResponse.status, 200);
		assert.equal(directoryResponse.headers.get("cache-control"), "private, no-store");
		assert.deepEqual((await directoryResponse.json() as { data: unknown }).data, [
			{ id: "doctor-1", fullName: "Dr. Public", specialties: ["Cardiology"] },
		]);

		const unauthorized = await getDoctorDirectoryRoute(new Request("http://localhost/api/cases/doctors"));
		assert.equal(unauthorized.status, 401);
		assert.equal(unauthorized.headers.get("cache-control"), "private, no-store");

		const selectionResponse = await patchDoctorSelectionRoute(new Request("http://localhost/api/cases/case-1/selection", {
			method: "PATCH",
			headers: { cookie: `patient_session=${patientToken}`, "content-type": "application/json" },
			body: JSON.stringify({ selectedDoctorId: "doctor-1" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(selectionResponse.status, 200);
		assert.equal(selectionResponse.headers.get("cache-control"), "private, no-store");
		assert.equal(savedOwner, "patient-1");
		assert.equal(savedSelection, "doctor-1");
		assert.equal((await selectionResponse.json() as { data: { selectedDoctorId: string } }).data.selectedDoctorId, "doctor-1");

		const unauthenticatedSelection = await patchDoctorSelectionRoute(new Request("http://localhost/api/cases/case-1/selection", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ selectedDoctorId: "doctor-1" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(unauthenticatedSelection.status, 401);
		const doctorToken = signAuthToken({ userId: "doctor-1", role: "doctor" });
		const wrongRoleSelection = await patchDoctorSelectionRoute(new Request("http://localhost/api/cases/case-1/selection", {
			method: "PATCH",
			headers: { cookie: `doctor_session=${doctorToken}`, "content-type": "application/json" },
			body: JSON.stringify({ selectedDoctorId: "doctor-1" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(wrongRoleSelection.status, 401);

		const invalidSelection = await patchDoctorSelectionRoute(new Request("http://localhost/api/cases/case-1/selection", {
			method: "PATCH",
			headers: { cookie: `patient_session=${patientToken}`, "content-type": "application/json" },
			body: JSON.stringify({ selectedDoctorId: " " }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(invalidSelection.status, 400);
	} finally {
		Object.assign(casesService, originalMethods);
	}
});

test("multipart parser accepts five documents and rejects batches above five", async () => {
	const form = new FormData();
	for (let index = 0; index < 5; index += 1) {
		form.append("documents", new Blob(["%PDF-1.7"], { type: "application/pdf" }), `report-${index}.pdf`);
	}
	const accepted = await parseCaseDocumentUploads(new Request("http://localhost/api/cases", { method: "POST", body: form }));
	assert.equal(accepted.length, 5);
	assert.equal(accepted[0].fileName, "report-0.pdf");

	const tooMany = new FormData();
	for (let index = 0; index < 6; index += 1) {
		tooMany.append("documents", new Blob(["%PDF-1.7"], { type: "application/pdf" }), `report-${index}.pdf`);
	}
	await assert.rejects(parseCaseDocumentUploads(new Request("http://localhost/api/cases", { method: "POST", body: tooMany })), { code: "VALIDATION_ERROR" });
});

test("multipart parser rejects requests over 50 MiB and accepts an actual body at the limit", async () => {
	const oversized = new Request("http://localhost/api/cases", {
		method: "POST",
		headers: { "content-type": "multipart/form-data; boundary=test", "content-length": String(50 * 1024 * 1024 + 1) },
	});
	await assert.rejects(parseCaseDocumentUploads(oversized), { code: "UPLOAD_TOO_LARGE" });

	const oversizedChunked = new Request("http://localhost/api/cases", {
		method: "POST",
		headers: { "content-type": "multipart/form-data; boundary=test" },
		body: new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(50 * 1024 * 1024 + 1));
				controller.close();
			},
		}),
		duplex: "half",
	} as RequestInit & { duplex: "half" });
	await assert.rejects(parseCaseDocumentUploads(oversizedChunked), { code: "UPLOAD_TOO_LARGE" });

	const boundary = "case-upload-boundary";
	const encoder = new TextEncoder();
	const prefix = encoder.encode(
		`--${boundary}\r\nContent-Disposition: form-data; name="documents"; filename="report.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7\r\n--${boundary}\r\nContent-Disposition: form-data; name="padding"\r\n\r\n`,
	);
	const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
	const body = new Uint8Array(50 * 1024 * 1024);
	body.set(prefix);
	body.fill(0x78, prefix.length, body.length - suffix.length);
	body.set(suffix, body.length - suffix.length);
	const atLimit = new Request("http://localhost/api/cases", {
		method: "POST",
		headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
		body,
		duplex: "half",
	} as RequestInit & { duplex: "half" });
	assert.equal((await parseCaseDocumentUploads(atLimit)).length, 1);

	const oversizedFile = new FormData();
	oversizedFile.append("documents", new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "application/pdf" }), "large.pdf");
	await assert.rejects(parseCaseDocumentUploads(new Request("http://localhost/api/cases", {
		method: "POST",
		body: oversizedFile,
	})), { code: "UPLOAD_TOO_LARGE" });
});

test("Patient draft routes require Patient auth; document reads admit Patient, Doctor, or Admin sessions", () => {
	const patientToken = signAuthToken({ userId: "patient-1", role: "patient" });
	const adminToken = signAuthToken({ userId: "admin-1", role: "admin" });
	const doctorToken = signAuthToken({ userId: "doctor-1", role: "doctor" });
	const patientRequest = new Request("http://localhost", { headers: { cookie: `patient_session=${patientToken}` } });
	assert.deepEqual(requirePatientContext(patientRequest), { userId: "patient-1", role: "patient" });

	const doctorAsPatient = new Request("http://localhost", { headers: { cookie: `patient_session=${doctorToken}` } });
	assert.throws(() => requirePatientContext(doctorAsPatient), { code: "SESSION_UNAUTHORIZED" });
	const adminRequest = new Request("http://localhost", { headers: { cookie: `admin_session=${adminToken}` } });
	assert.deepEqual(requireDocumentReaderContext(adminRequest), { userId: "admin-1", role: "admin" });
	const doctorRequest = new Request("http://localhost", { headers: { cookie: `doctor_session=${doctorToken}` } });
	assert.deepEqual(requireDoctorContext(doctorRequest), { userId: "doctor-1", role: "doctor" });
	assert.deepEqual(requireDocumentReaderContext(doctorRequest), { userId: "doctor-1", role: "doctor" });
});

test("document GET route returns private attachment headers and denies unauthorized roles", async () => {
	const originalGetDocument = casesService.getDocument;
	casesService.getDocument = async (_documentId, caller) => {
		if (caller.role === "doctor") throw new CaseAccessDeniedError();
		return { bytes: new TextEncoder().encode("%PDF-1.7"), fileName: "scan report.pdf", contentType: "application/pdf" };
	};
	try {
		const patientToken = signAuthToken({ userId: "patient-1", role: "patient" });
		const response = await getDocumentRoute(new Request("http://localhost/api/cases/documents/doc-1", {
			headers: { cookie: `patient_session=${patientToken}` },
		}), { params: Promise.resolve({ documentId: "doc-1" }) });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.equal(response.headers.get("content-type"), "application/pdf");
		assert.equal(response.headers.get("x-content-type-options"), "nosniff");
		assert.match(response.headers.get("content-disposition") ?? "", /attachment/);
		assert.equal(new TextDecoder().decode(await response.arrayBuffer()), "%PDF-1.7");

		const doctorToken = signAuthToken({ userId: "doctor-1", role: "doctor" });
		const denied = await getDocumentRoute(new Request("http://localhost/api/cases/documents/doc-1", {
			headers: { cookie: `doctor_session=${doctorToken}` },
		}), { params: Promise.resolve({ documentId: "doc-1" }) });
		assert.equal(denied.status, 403);
	} finally {
		casesService.getDocument = originalGetDocument;
	}
});

test("submission parser accepts only the supported urgency tiers", async () => {
	assert.deepEqual(await parseCaseSubmissionRequest(new Request("http://localhost", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ urgencyTier: "Urgent", selectedDoctorId: " doctor-1 " }),
	})), { urgencyTier: "Urgent", selectedDoctorId: "doctor-1" });
	assert.deepEqual(await parseCaseSubmissionRequest(new Request("http://localhost", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ urgencyTier: "Standard" }),
	})), { urgencyTier: "Standard" });
	await assert.rejects(parseCaseSubmissionRequest(new Request("http://localhost", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ urgencyTier: "Emergency" }),
	})), { code: "VALIDATION_ERROR" });
});

test("submit and fee routes require Patient auth and return private envelopes", async () => {
	const originalMethods = { submitCase: casesService.submitCase, getPaymentOptions: casesService.getPaymentOptions };
	let submittedBy = "";
	casesService.submitCase = async (caller, caseId, urgencyTier, selectedDoctorId) => {
		submittedBy = caller.userId;
		return { caseId, doctorId: selectedDoctorId ?? null, urgencyTier, chargedAmount: "2000.00", selectedDoctorId: selectedDoctorId ?? null, status: "Submitted" };
	};
	casesService.getPaymentOptions = async () => ({ standardCaseFee: "1000.00", urgentCaseFee: "2000.00" });
	try {
		const patientToken = signAuthToken({ userId: "patient-1", role: "patient" });
		const response = await postCaseSubmitRoute(new Request("http://localhost/api/cases/case-1/submit", {
			method: "POST",
			headers: { cookie: `patient_session=${patientToken}`, "content-type": "application/json" },
			body: JSON.stringify({ urgencyTier: "Urgent", selectedDoctorId: "doctor-1" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.equal(submittedBy, "patient-1");
		assert.equal((await response.json() as { data: { chargedAmount: string } }).data.chargedAmount, "2000.00");

		const fees = await getCaseFeesRoute(new Request("http://localhost/api/cases/fees", {
			headers: { cookie: `patient_session=${patientToken}` },
		}));
		assert.equal(fees.status, 200);
		assert.equal(fees.headers.get("cache-control"), "private, no-store");
		assert.deepEqual((await fees.json() as { data: unknown }).data, { standardCaseFee: "1000.00", urgentCaseFee: "2000.00" });

		const unauthorized = await postCaseSubmitRoute(new Request("http://localhost/api/cases/case-1/submit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ urgencyTier: "Standard" }),
		}), { params: Promise.resolve({ caseId: "case-1" }) });
		assert.equal(unauthorized.status, 401);
	} finally {
		Object.assign(casesService, originalMethods);
	}
});