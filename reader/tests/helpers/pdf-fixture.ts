/**
 * Minimal PDF builder for fixtures. Produces a syntactically valid PDF 1.4
 * with one Helvetica text object per page — small enough to build in-memory
 * and ship through pdfjs-dist's loader the same way an uploaded file would.
 */

export function buildSimplePdf(pageTexts: string[]): Buffer {
    const parts: Buffer[] = [];
    const offsets: number[] = [];
    let totalLen = 0;

    function emit(s: string | Buffer) {
        const buf = typeof s === 'string' ? Buffer.from(s, 'binary') : s;
        parts.push(buf);
        totalLen += buf.length;
    }
    function recordObj() {
        offsets.push(totalLen);
    }

    emit('%PDF-1.4\n');
    emit('%\xE2\xE3\xCF\xD3\n'); // 4-byte binary marker so readers treat it as binary

    recordObj();
    emit('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const numPages = pageTexts.length;
    const pageObjIds: number[] = [];
    const contentObjIds: number[] = [];
    for (let i = 0; i < numPages; i++) {
        pageObjIds.push(3 + i * 2);
        contentObjIds.push(4 + i * 2);
    }

    recordObj();
    emit(`2 0 obj\n<< /Type /Pages /Kids [${pageObjIds
        .map((id) => `${id} 0 R`)
        .join(' ')}] /Count ${numPages} >>\nendobj\n`);

    for (let i = 0; i < numPages; i++) {
        const text = escapePdfString(pageTexts[i]);
        const streamContent = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
        const streamLen = Buffer.byteLength(streamContent, 'binary');

        recordObj();
        emit(
            `${pageObjIds[i]} 0 obj\n` +
                `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjIds[i]} 0 R ` +
                `/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\n` +
                `endobj\n`,
        );

        recordObj();
        emit(
            `${contentObjIds[i]} 0 obj\n` +
                `<< /Length ${streamLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
        );
    }

    const xrefStart = totalLen;
    const totalObjs = 1 + offsets.length;
    emit(`xref\n0 ${totalObjs}\n`);
    emit('0000000000 65535 f \n');
    for (const offset of offsets) {
        emit(`${offset.toString().padStart(10, '0')} 00000 n \n`);
    }
    emit(`trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\n`);
    emit(`startxref\n${xrefStart}\n`);
    emit('%%EOF\n');

    return Buffer.concat(parts);
}

function escapePdfString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}
