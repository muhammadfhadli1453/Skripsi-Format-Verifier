// Shared by the browser and the routes; keep it free of server-only imports.

/**
 * Vercel rejects function request bodies over 4.5 MB. Files up to this size go straight to
 * /api/verify (and reach Blob only if they place); larger ones must travel through Blob first.
 */
export const DIRECT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

export const MIME = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as const;

export const mimeOf = (name: string) => MIME[/\.pdf$/i.test(name) ? "pdf" : "docx"];

/** Blob pathnames: keep the name readable but drop characters that need escaping. */
export const blobName = (name: string) => name.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").replace(/\.(docx|pdf)$/i, (m) => m.toLowerCase());
