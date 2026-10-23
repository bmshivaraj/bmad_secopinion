"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AccountProfileLink } from "../../components/account-profile-link";

interface ApiEnvelope<T> {
	data: T | null;
	error: { code: string; message: string } | null;
}

interface CaseDocument {
	id: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
}

interface CaseDraft {
	id: string;
	doctorId: string | null;
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	selectedDoctorId: string | null;
	urgencyTier: "Standard" | "Urgent" | null;
	chargedAmount: string | null;
	paymentAttemptStatus?: "Pending" | "Failed" | "Succeeded" | null;
	status: "Draft" | "Submitted";
	documents: CaseDocument[];
	createdAt: string;
	updatedAt: string;
}

interface PaymentOptions {
	standardCaseFee: string;
	urgentCaseFee: string;
}

interface CaseSubmission {
	caseId: string;
	doctorId: string | null;
	urgencyTier: "Standard" | "Urgent";
	chargedAmount: string;
	selectedDoctorId: string | null;
	status: "Submitted";
}

interface DoctorDirectoryEntry {
	id: string;
	fullName: string;
	specialties: string[];
}

interface DraftFields {
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
}

const EMPTY_FIELDS: DraftFields = {
	affectedBodyArea: "",
	condition: "",
	recommendation: "",
	additionalDetails: "",
};

async function requestApi<T>(url: string, init?: RequestInit): Promise<T> {
	const response = await fetch(url, { ...init, credentials: "same-origin" });
	if (response.status === 401) {
		window.location.assign("/login");
		throw new Error("Your Patient session has expired. Sign in to continue.");
	}
	let result: ApiEnvelope<T>;
	try {
		result = await response.json() as ApiEnvelope<T>;
	} catch {
		throw new Error("The server returned an unexpected response. Please try again.");
	}
	if (!response.ok || result.error) throw new Error(result.error?.message ?? "Unable to complete the request.");
	return result.data as T;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Unable to complete the request. Please try again.";
}

function formatSize(sizeBytes: number): string {
	if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function NewCasePage() {
	const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
	const creationRequestId = useRef<string | null>(null);
	const [draft, setDraft] = useState<CaseDraft | null>(null);
	const [paymentOptions, setPaymentOptions] = useState<PaymentOptions | null>(null);
	const [urgencyTier, setUrgencyTier] = useState<"Standard" | "Urgent">("Standard");
	const [doctors, setDoctors] = useState<DoctorDirectoryEntry[]>([]);
	const [selectedDoctorId, setSelectedDoctorId] = useState<string | null>(null);
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [fileInputVersion, setFileInputVersion] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [isBusy, setIsBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [isLoadingDoctors, setIsLoadingDoctors] = useState(true);
	const [doctorDirectoryError, setDoctorDirectoryError] = useState("");

	useEffect(() => {
		requestApi<CaseDraft | null>("/api/cases/draft")
			.then((savedDraft) => {
				if (!savedDraft) return;
				setDraft(savedDraft);
				setSelectedDoctorId(savedDraft.selectedDoctorId);
				if (savedDraft.urgencyTier) setUrgencyTier(savedDraft.urgencyTier);
				setFields({
					affectedBodyArea: savedDraft.affectedBodyArea,
					condition: savedDraft.condition,
					recommendation: savedDraft.recommendation,
					additionalDetails: savedDraft.additionalDetails,
				});
			})
			.catch((loadError: unknown) => setError(errorMessage(loadError)))
			.finally(() => setIsLoading(false));
	}, []);

	useEffect(() => {
		requestApi<PaymentOptions>("/api/cases/fees")
			.then(setPaymentOptions)
			.catch((loadError: unknown) => setError(errorMessage(loadError)));
	}, []);

	useEffect(() => {
		requestApi<DoctorDirectoryEntry[]>("/api/cases/doctors")
			.then(setDoctors)
			.catch((loadError: unknown) => setDoctorDirectoryError(errorMessage(loadError)))
			.finally(() => setIsLoadingDoctors(false));
	}, []);

	function updateField(field: keyof DraftFields, value: string) {
		setFields((current) => ({ ...current, [field]: value }));
	}

	async function saveCurrentDraft(): Promise<CaseDraft> {
		if (!draft && !creationRequestId.current) creationRequestId.current = crypto.randomUUID();
		const savedDraft = await requestApi<CaseDraft>("/api/cases/draft", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				...fields,
				...(draft ? { caseId: draft.id } : { creationRequestId: creationRequestId.current }),
			}),
		});
		setDraft(savedDraft);
		return savedDraft;
	}

	async function handleSave(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setNotice("");
		setIsBusy(true);
		try {
			if (!hasRecoverablePayment) await saveCurrentDraft();
			setNotice("Draft saved. You can return to finish it later.");
		} catch (saveError) {
			setError(errorMessage(saveError));
		} finally {
			setIsBusy(false);
		}
	}

	async function handleUpload(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setNotice("");
		if (selectedFiles.length < 1 || selectedFiles.length > 5) {
			setError("Choose between 1 and 5 documents.");
			return;
		}
		const oversizedFile = selectedFiles.find((file) => file.size > 10 * 1024 * 1024);
		if (oversizedFile) {
			setError(`${oversizedFile.name} is larger than 10 MiB.`);
			return;
		}

		setIsBusy(true);
		try {
			const savedDraft = await saveCurrentDraft();
			const formData = new FormData();
			selectedFiles.forEach((file) => formData.append("documents", file));
			const uploadedDocuments = await requestApi<CaseDocument[]>(`/api/cases/${savedDraft.id}/documents`, {
				method: "POST",
				body: formData,
			});
			setDraft((current) => current
				? { ...current, documents: [...current.documents, ...uploadedDocuments] }
				: current);
			setSelectedFiles([]);
			setFileInputVersion((current) => current + 1);
			setNotice("Documents uploaded and attached to your private draft.");
		} catch (uploadError) {
			setError(errorMessage(uploadError));
		} finally {
			setIsBusy(false);
		}
	}

	async function handleDelete(documentId: string) {
		setError("");
		setNotice("");
		setIsBusy(true);
		try {
			await requestApi<{ deleted: boolean }>(`/api/cases/documents/${documentId}`, { method: "DELETE" });
			setDraft((current) => current
				? { ...current, documents: current.documents.filter((document) => document.id !== documentId) }
				: current);
			setNotice("Document removed from your draft.");
		} catch (deleteError) {
			setError(errorMessage(deleteError));
		} finally {
			setIsBusy(false);
		}
	}

	async function handleSubmitCase() {
		if (!draft || draft.documents.length === 0) {
			setError("Save your details and upload at least one supporting document before submitting.");
			return;
		}
		if (!paymentOptions && !hasRecoverablePayment) {
			setError("Current case fees are unavailable. Try again shortly.");
			return;
		}
		setError("");
		setNotice("");
		setIsBusy(true);
		try {
			if (!hasRecoverablePayment) {
				if (!paymentOptions) throw new Error("Current case fees are unavailable. Try again shortly.");
				const latestOptions = await requestApi<PaymentOptions>("/api/cases/fees");
				const displayedFee = urgencyTier === "Urgent" ? paymentOptions.urgentCaseFee : paymentOptions.standardCaseFee;
				const currentFee = urgencyTier === "Urgent" ? latestOptions.urgentCaseFee : latestOptions.standardCaseFee;
				if (displayedFee !== currentFee) {
					setPaymentOptions(latestOptions);
					setNotice("The current fee changed. Review the updated amount and submit again.");
					return;
				}
			}
			await saveCurrentDraft();
			const result = await requestApi<CaseSubmission>(`/api/cases/${draft.id}/submit`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ urgencyTier, selectedDoctorId }),
			});
			setDraft((current) => current ? {
				...current,
				doctorId: result.doctorId,
				status: "Submitted",
				urgencyTier: result.urgencyTier,
				chargedAmount: result.chargedAmount,
				selectedDoctorId: result.selectedDoctorId,
			} : current);
			setSelectedDoctorId(result.selectedDoctorId);
			setUrgencyTier(result.urgencyTier);
			setNotice(`Payment complete. Your Case was submitted for review at ₹${result.chargedAmount}.`);
		} catch (submitError) {
			setError(errorMessage(submitError));
			try {
				const refreshedDraft = await requestApi<CaseDraft | null>("/api/cases/draft");
				if (refreshedDraft) {
					setDraft(refreshedDraft);
					setSelectedDoctorId(refreshedDraft.selectedDoctorId);
					if (refreshedDraft.urgencyTier) setUrgencyTier(refreshedDraft.urgencyTier);
				}
			} catch {
				// Keep the submission error visible if refreshing retry state also fails.
			}
		} finally {
			setIsBusy(false);
		}
	}

	async function persistDoctorSelection(doctorId: string | null) {
		if (!draft) {
			setError("Save your condition details before choosing a Doctor.");
			return;
		}
		setError("");
		setNotice("");
		setIsBusy(true);
		try {
			const savedDraft = await requestApi<CaseDraft>(`/api/cases/${draft.id}/selection`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ selectedDoctorId: doctorId }),
			});
			setDraft(savedDraft);
			setSelectedDoctorId(savedDraft.selectedDoctorId);
			setNotice(doctorId ? "Doctor preference saved to your private draft." : "Doctor preference cleared.");
		} catch (selectionError) {
			setError(errorMessage(selectionError));
		} finally {
			setIsBusy(false);
		}
	}

	async function handleSaveDoctorSelection(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		await persistDoctorSelection(selectedDoctorId);
	}

	const isSubmitted = draft?.status === "Submitted";
	const hasRecoverablePayment = draft?.paymentAttemptStatus === "Pending" || draft?.paymentAttemptStatus === "Succeeded";
	const selectedFee = hasRecoverablePayment
		? draft?.chargedAmount ?? undefined
		: urgencyTier === "Urgent" ? paymentOptions?.urgentCaseFee : paymentOptions?.standardCaseFee;

	return (
		<main className="case-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/">
					<span className="case-brand-mark" aria-hidden="true">S</span>
					SecOpinion
				</Link>
				<nav className="patient-case-nav" aria-label="Patient account">
					<Link className="case-account-link" href="/cases">My Cases</Link>
					<AccountProfileLink role="patient" />
				</nav>
			</header>

			<div className="case-content">
				<div className="case-heading">
					<p className="case-kicker">PATIENT INTAKE <span>/</span> {isSubmitted ? "SUBMITTED CASE" : "PRIVATE DRAFT"}</p>
					<h1>{isSubmitted ? "Case submitted." : "Tell us what's happening."}</h1>
					<p className="case-intro">{isSubmitted ? "Your payment and review preference are recorded. The Case is now submitted." : "Describe your current condition and the treatment recommendation you received. You can save now and return to add documents later."}</p>
				</div>

				{error && <p className="case-message case-message-error" role="alert">{error}</p>}
				{notice && <p className="case-message case-message-success" role="status">{notice}</p>}

				{isLoading ? (
					<p className="case-loading" role="status">Loading your draft...</p>
				) : (
					<>
						<form className="case-form" onSubmit={handleSave}>
							<div className="case-section-heading">
								<span className="case-step-number">01</span>
								<div>
									<h2>Describe your condition</h2>
									<p>Share the details as they were explained to you.</p>
								</div>
							</div>
							<div className="case-fields-grid">
								<div className="case-field case-field-area">
									<label htmlFor="affectedBodyArea">Affected body area</label>
									<input id="affectedBodyArea" name="affectedBodyArea" autoComplete="off" maxLength={120} required disabled={isBusy || isSubmitted || hasRecoverablePayment} value={fields.affectedBodyArea} onChange={(event) => updateField("affectedBodyArea", event.target.value)} placeholder="For example, left knee" />
								</div>
								<div className="case-field">
									<label htmlFor="condition">Current condition or diagnosis</label>
									<textarea id="condition" name="condition" maxLength={2000} required disabled={isBusy || isSubmitted || hasRecoverablePayment} value={fields.condition} onChange={(event) => updateField("condition", event.target.value)} placeholder="What have you been told about your condition?" rows={4} />
								</div>
								<div className="case-field">
									<label htmlFor="recommendation">Treatment or surgery recommendation</label>
									<textarea id="recommendation" name="recommendation" maxLength={2000} required disabled={isBusy || isSubmitted || hasRecoverablePayment} value={fields.recommendation} onChange={(event) => updateField("recommendation", event.target.value)} placeholder="What treatment or surgery was recommended?" rows={4} />
								</div>
								<div className="case-field case-field-wide">
									<label htmlFor="additionalDetails">Anything else you would like the Doctor to know <span>Optional</span></label>
									<textarea id="additionalDetails" name="additionalDetails" maxLength={5000} disabled={isBusy || isSubmitted || hasRecoverablePayment} value={fields.additionalDetails} onChange={(event) => updateField("additionalDetails", event.target.value)} placeholder="Add symptoms, timing, questions, or other context" rows={4} />
								</div>
							</div>
							<div className="case-form-actions">
								{draft && <span className="case-saved-state">{isSubmitted ? "Case submitted" : "Draft saved"}</span>}
								<button className="case-button case-button-primary" type="submit" disabled={isBusy || isSubmitted || hasRecoverablePayment}>
										{isBusy ? "Saving..." : "Save draft"}
								</button>
							</div>
						</form>

						<section className="case-documents" aria-labelledby="case-documents-heading">
							<div className="case-section-heading">
								<span className="case-step-number">02</span>
								<div>
									<h2 id="case-documents-heading">Add supporting documents</h2>
									<p>Upload reports, scans, or other records related to this condition.</p>
								</div>
							</div>
							<form className="case-upload-form" onSubmit={handleUpload}>
								<label className="case-file-picker" htmlFor="case-documents-input">
									<span className="case-file-symbol" aria-hidden="true">+</span>
									<span><strong>Choose documents</strong><small>JPEG, PNG, or PDF | up to 5 files | 10 MiB each</small></span>
									<input key={fileInputVersion} id="case-documents-input" type="file" accept="image/jpeg,image/png,application/pdf" multiple disabled={isBusy || isSubmitted || hasRecoverablePayment} onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} />
								</label>
								{selectedFiles.length > 0 && <p className="case-selection-summary">{selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected | {selectedFiles.map(({ name }) => name).join(", ")}</p>}
								<button className="case-button case-button-secondary" type="submit" disabled={isBusy || isSubmitted || hasRecoverablePayment || selectedFiles.length === 0}>
									{isBusy ? "Working..." : "Upload selected files"}
								</button>
							</form>

							{draft && draft.documents.length > 0 ? (
								<ul className="case-document-list">
									{draft.documents.map((document) => (
										<li key={document.id}>
											<div className="case-document-file">
												<span className="case-document-type" aria-hidden="true">{document.contentType === "application/pdf" ? "PDF" : "IMG"}</span>
												<div><a href={`/api/cases/documents/${document.id}`}>{document.fileName}</a><span>{formatSize(document.sizeBytes)}</span></div>
											</div>
											<button className="case-remove-button" type="button" disabled={isBusy || isSubmitted || hasRecoverablePayment} onClick={() => handleDelete(document.id)}>Remove</button>
										</li>
									))}
								</ul>
							) : (
								<p className="case-no-documents">No supporting documents uploaded yet.</p>
							)}
						</section>

						<section className="case-doctor-selection" aria-labelledby="case-doctor-selection-heading">
							<div className="case-section-heading">
								<span className="case-step-number">03</span>
								<div>
									<h2 id="case-doctor-selection-heading">Choose a Doctor <span>Optional</span></h2>
									<p>Your preference stays private with this draft. You can also continue without choosing.</p>
								</div>
							</div>
							{isLoadingDoctors ? (
								<p className="case-doctor-state" role="status">Loading verified Doctors...</p>
							) : doctorDirectoryError ? (
								<p className="case-doctor-state case-doctor-state-error" role="alert">{doctorDirectoryError}</p>
							) : doctors.length === 0 ? (
								<p className="case-doctor-state">No verified Doctors are available right now. You can continue without a selection.</p>
							) : (
								<form className="case-doctor-form" onSubmit={handleSaveDoctorSelection}>
									<fieldset className="case-doctor-list" disabled={isBusy || !draft || isSubmitted || hasRecoverablePayment}>
										<legend className="case-visually-hidden">Doctor preference</legend>
										<label className="case-doctor-option">
											<input type="radio" name="doctor-preference" checked={selectedDoctorId === null} onChange={() => setSelectedDoctorId(null)} />
											<span><strong>No preference</strong><small>Keep this Case unassigned for now.</small></span>
										</label>
										{doctors.map((doctor) => (
											<label className="case-doctor-option" key={doctor.id}>
												<input type="radio" name="doctor-preference" checked={selectedDoctorId === doctor.id} onChange={() => setSelectedDoctorId(doctor.id)} />
												<span><strong>{doctor.fullName}</strong><small>{doctor.specialties.join(" · ")}</small></span>
											</label>
										))}
									</fieldset>
									{!draft && <p className="case-doctor-state">Save your draft before saving a Doctor preference.</p>}
									{draft?.selectedDoctorId && !doctors.some(({ id }) => id === draft.selectedDoctorId) && (
										<p className="case-doctor-state case-doctor-state-error">Your saved Doctor is no longer available. Clear the preference or choose another verified Doctor.</p>
									)}
									<div className="case-doctor-actions">
										<button className="case-button case-button-secondary" type="submit" disabled={isBusy || !draft || isSubmitted || hasRecoverablePayment}>
											{isBusy ? "Saving..." : "Save preference"}
										</button>
									</div>
								</form>
							)}
							{draft?.selectedDoctorId && <button className="case-remove-button case-doctor-clear" type="button" disabled={isBusy || isSubmitted || hasRecoverablePayment} onClick={() => void persistDoctorSelection(null)}>Clear selection</button>}
						</section>

						<section className="case-next-step case-checkout" aria-labelledby="case-next-step-heading">
							<div className="case-checkout-details">
								<p className="case-next-step-label">{isSubmitted ? "SUBMITTED" : "04 / REVIEW & PAYMENT"}</p>
								<h2 id="case-next-step-heading">{isSubmitted ? "Your Case is submitted." : draft?.documents.length ? "Choose a review speed." : "Upload a document to continue."}</h2>
								<p>{isSubmitted
									? `Captured fee: ₹${draft.chargedAmount ?? "0.00"}. Your submitted urgency cannot be changed.`
									: hasRecoverablePayment
										? `A payment attempt for ₹${draft?.chargedAmount ?? "0.00"} is being recovered. Retry uses the same attempt and will not create a second charge.`
										: "Standard and Urgent fees are set by the platform and captured when your Case is submitted."}</p>
								<fieldset className="case-urgency-options" disabled={isBusy || isSubmitted || hasRecoverablePayment || !paymentOptions}>
									<legend>Review speed</legend>
									<label>
										<input type="radio" name="urgency-tier" checked={urgencyTier === "Standard"} onChange={() => setUrgencyTier("Standard")} />
										<span><strong>Standard</strong><small>₹{paymentOptions?.standardCaseFee ?? "—"}</small></span>
									</label>
									<label>
										<input type="radio" name="urgency-tier" checked={urgencyTier === "Urgent"} onChange={() => setUrgencyTier("Urgent")} />
										<span><strong>Urgent</strong><small>₹{paymentOptions?.urgentCaseFee ?? "—"}</small></span>
									</label>
								</fieldset>
								<p className="case-payment-note">Urgent means expedited written review, not emergency care. V1 uses a mock provider; no real payment is collected.</p>
							</div>
							<div className="case-checkout-action">
								<button className="case-button case-button-dark" type="button" disabled={isBusy || isSubmitted || !draft || draft.documents.length === 0 || !selectedFee} onClick={() => void handleSubmitCase()}>
									{isSubmitted ? "Submitted" : isBusy ? "Submitting..." : hasRecoverablePayment ? `Complete submission (₹${selectedFee})` : selectedFee ? `Pay ₹${selectedFee} and submit` : "Loading fees..."}
								</button>
								<p>{draft?.documents.length ? "Your draft stays private until payment succeeds." : "At least one supporting document is required."}</p>
							</div>
						</section>
					</>
				)}
			</div>
		</main>
	);
}