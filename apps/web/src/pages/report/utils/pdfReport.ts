import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface PdfReportRow {
    entityName: string;
    unit: string;
    last: number | string;
    min: number | string;
    max: number | string;
    avg: number | string;
}

export interface PdfReportOptions {
    title: string;
    companyName?: string;
    dateRange: string;
    rows: PdfReportRow[];
    generatedAt: string;
    defaultTitle: string;
    generatedAtLabel: string;
    ariotLabel: string;
    tableHeaders: { entityName: string; unit: string; last: string; min: string; max: string; avg: string };
}

const fmt = (v: number | string): string =>
    typeof v === 'number' ? (Number.isNaN(v) ? '—' : String(v)) : (v ?? '—');

/**
 * Builds a telemetry PDF and returns a Blob.
 */
export function buildTelemetryPdf(options: PdfReportOptions): Blob {
    const doc = new jsPDF();
    const { title, companyName, dateRange, rows, generatedAt, defaultTitle, generatedAtLabel, ariotLabel, tableHeaders } = options;
    const reportTitle = title?.trim() || defaultTitle;
    let y = 16;

    doc.setFontSize(16);
    doc.text(reportTitle, 14, y);
    y += 10;

    if (companyName?.trim()) {
        doc.setFontSize(11);
        doc.text(companyName.trim(), 14, y);
        y += 6;
    }

    doc.setFontSize(10);
    doc.text(dateRange, 14, y);
    y += 8;

    if (rows.length > 0) {
        autoTable(doc, {
            startY: y,
            head: [[tableHeaders.entityName, tableHeaders.unit, tableHeaders.last, tableHeaders.min, tableHeaders.max, tableHeaders.avg]],
            body: rows.map(r => [r.entityName, r.unit || '—', fmt(r.last), fmt(r.min), fmt(r.max), fmt(r.avg)]),
            theme: 'grid',
            headStyles: { fillColor: [66, 139, 202], textColor: 255 },
            margin: { left: 14, right: 14 },
        });
        const tbl = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
        y = tbl?.finalY ?? y + 20;
    }

    y += 10;
    doc.setFontSize(9);
    doc.text(`${generatedAtLabel} ${generatedAt}`, 14, y);
    y += 5;
    doc.text(ariotLabel, 14, y);

    return doc.output('blob');
}
