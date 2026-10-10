"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

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
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	status: "Draft";
	documents: CaseDocument[];
	createdAt: string;
	updatedAt: string;
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
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [fileInputVersion, setFileInputVersion] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [isBusy, setIsBusy] = useState(false);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	useEffect(() => {
		requestApi<CaseDraft | null>("/api/cases/draft")
			.then((savedDraft) => {
				if (!savedDraft) return;
				setDraft(savedDraft);
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
			await saveCurrentDraft();
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

	async function handleReadiness() {
		if (!draft) {
			setError("Save your condition details before checking the next step.");
			return;
		}
		setError("");
		setNotice("");
		setIsBusy(true);
		try {
			await saveCurrentDraft();
			await requestApi<{ caseId: string; ready: true }>(`/api/cases/${draft.id}/readiness`);
			setNotice("Your draft has the required supporting document for the next step.");
		} catch (readinessError) {
			setError(errorMessage(readinessError));
		} finally {
			setIsBusy(false);
		}
	}

	return (
		<main className="case-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/">
					<span className="case-brand-mark" aria-hidden="true">S</span>
					SecOpinion
				</Link>
				<Link className="case-account-link" href="/login">Patient account</Link>
			</header>

			<div className="case-content">
				<div className="case-heading">
					<p className="case-kicker">PATIENT INTAKE <span>/</span> PRIVATE DRAFT</p>
					<h1>Tell us what's happening.</h1>
					<p className="case-intro">Describe your current condition and the treatment recommendation you received. You can save now and return to add documents later.</p>
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
									<input id="affectedBodyArea" name="affectedBodyArea" autoComplete="off" maxLength={120} required disabled={isBusy} value={fields.affectedBodyArea} onChange={(event) => updateField("affectedBodyArea", event.target.value)} placeholder="For example, left knee" />
								</div>
								<div className="case-field">
									<label htmlFor="condition">Current condition or diagnosis</label>
									<textarea id="condition" name="condition" maxLength={2000} required disabled={isBusy} value={fields.condition} onChange={(event) => updateField("condition", event.target.value)} placeholder="What have you been told about your condition?" rows={4} />
								</div>
								<div className="case-field">
									<label htmlFor="recommendation">Treatment or surgery recommendation</label>
									<textarea id="recommendation" name="recommendation" maxLength={2000} required disabled={isBusy} value={fields.recommendation} onChange={(event) => updateField("recommendation", event.target.value)} placeholder="What treatment or surgery was recommended?" rows={4} />
								</div>
								<div className="case-field case-field-wide">
									<label htmlFor="additionalDetails">Anything else you would like the Doctor to know <span>Optional</span></label>
									<textarea id="additionalDetails" name="additionalDetails" maxLength={5000} disabled={isBusy} value={fields.additionalDetails} onChange={(event) => updateField("additionalDetails", event.target.value)} placeholder="Add symptoms, timing, questions, or other context" rows={4} />
								</div>
							</div>
							<div className="case-form-actions">
								{draft && <span className="case-saved-state">Draft {draft.status.toLowerCase()}</span>}
								<button className="case-button case-button-primary" type="submit" disabled={isBusy}>
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
									<input key={fileInputVersion} id="case-documents-input" type="file" accept="image/jpeg,image/png,application/pdf" multiple disabled={isBusy} onChange={(event) => setSelectedFiles(Array.from(event.target.files ?? []))} />
								</label>
								{selectedFiles.length > 0 && <p className="case-selection-summary">{selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected | {selectedFiles.map(({ name }) => name).join(", ")}</p>}
								<button className="case-button case-button-secondary" type="submit" disabled={isBusy || selectedFiles.length === 0}>
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
											<button className="case-remove-button" type="button" disabled={isBusy} onClick={() => handleDelete(document.id)}>Remove</button>
										</li>
									))}
								</ul>
							) : (
								<p className="case-no-documents">No supporting documents uploaded yet.</p>
							)}
						</section>

						<section className="case-next-step" aria-labelledby="case-next-step-heading">
							<div>
								<p className="case-next-step-label">DRAFT CHECK</p>
								<h2 id="case-next-step-heading">{draft && draft.documents.length > 0 ? "Your draft has its required supporting document." : "One document is needed before you continue."}</h2>
								<p>Your draft stays private and is not visible to Doctors while it is incomplete.</p>
							</div>
							<button className="case-button case-button-dark" type="button" disabled={isBusy || !draft} onClick={handleReadiness}>Check readiness</button>
						</section>
					</>
				)}
			</div>
		</main>
	);
}