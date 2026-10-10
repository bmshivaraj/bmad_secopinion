import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:password@localhost:5432/secopinion_test";
process.env.JWT_SECRET ??= "cases-route-test-secret";

const {
	parseCaseDocumentUploads,
	parseCaseDraftRequest,
	requireDocumentReaderContext,
	requirePatientContext,
} = await import("./routes");
const { GET: getDocumentRoute } = await import("../../app/api/cases/documents/[documentId]/route");
const { casesService } = await import("./service");
const { CaseAccessDeniedError } = await import("./domain");
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

test("Patient draft routes require a verified Patient session; document reads admit Patient or Admin only", () => {
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
	assert.throws(() => requireDocumentReaderContext(doctorRequest), { code: "SESSION_UNAUTHORIZED" });
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
		assert.equal(denied.status, 401);
	} finally {
		casesService.getDocument = originalGetDocument;
	}
});