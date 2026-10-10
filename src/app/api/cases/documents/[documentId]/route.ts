import { NextResponse } from "next/server";
import { casesService } from "../../../../../modules/cases/service";
import {
	requireDocumentReaderContext,
	requirePatientContext,
	toCasesErrorResponse,
} from "../../../../../modules/cases/routes";
import { ok } from "../../../../../shared/api-envelope";

interface RouteContext {
	params: Promise<{ documentId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requireDocumentReaderContext(request);
		const { documentId } = await context.params;
		const document = await casesService.getDocument(documentId, caller);
		const bytes = new Uint8Array(document.bytes.byteLength);
		bytes.set(document.bytes);
		const fileName = encodeURIComponent(document.fileName);
		return new NextResponse(bytes.buffer as ArrayBuffer, {
			headers: {
				"cache-control": "private, no-store",
				"content-disposition": `attachment; filename="document"; filename*=UTF-8''${fileName}`,
				"content-type": document.contentType,
				"x-content-type-options": "nosniff",
			},
		});
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}

export async function DELETE(request: Request, context: RouteContext): Promise<NextResponse> {
	try {
		const caller = requirePatientContext(request);
		const { documentId } = await context.params;
		await casesService.deleteDocument(documentId, caller);
		return NextResponse.json(ok({ deleted: true }), { headers: { "cache-control": "private, no-store" } });
	} catch (error) {
		return toCasesErrorResponse(error);
	}
}