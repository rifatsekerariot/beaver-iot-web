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

export interface PdfReportDeviceSection {
    deviceName: string;
    rows: PdfReportRow[];
}

export interface PdfReportOptions {
    title: string;
    companyName?: string;
    dashboardName?: string;
    dateRange: string;
    deviceSections: PdfReportDeviceSection[];
    generatedAt: string;
    defaultTitle: string;
    generatedAtLabel: string;
    ariotLabel: string;
    dashboardLabel: string;
    deviceLabel: string;
    tableHeaders: { entityName: string; unit: string; last: string; min: string; max: string; avg: string };
}

const fmt = (v: number | string): string =>
    typeof v === 'number' ? (Number.isNaN(v) ? '—' : String(v)) : (v ?? '—');

/**
 * Builds a telemetry PDF with device-based sections and returns a Blob.
 */
export function buildTelemetryPdf(options: PdfReportOptions): Blob {
    const doc = new jsPDF();
    const {
        title,
        companyName,
        dashboardName,
        dateRange,
        deviceSections,
        generatedAt,
        defaultTitle,
        generatedAtLabel,
        ariotLabel,
        dashboardLabel,
        deviceLabel,
        tableHeaders,
    } = options;
    const reportTitle = title?.trim() || defaultTitle;
    let y = 16;

    // Report title
    doc.setFontSize(16);
    doc.text(reportTitle, 14, y);
    y += 10;

    // Company name (optional)
    if (companyName?.trim()) {
        doc.setFontSize(11);
        doc.text(companyName.trim(), 14, y);
        y += 6;
    }

    // Dashboard name
    if (dashboardName?.trim()) {
        doc.setFontSize(11);
        doc.text(`${dashboardLabel}: ${dashboardName.trim()}`, 14, y);
        y += 6;
    }

    // Date range
    doc.setFontSize(10);
    doc.text(dateRange, 14, y);
    y += 8;

    // Device sections
    if (deviceSections.length > 0) {
        for (let i = 0; i < deviceSections.length; i++) {
            const section = deviceSections[i];
            if (section.rows.length === 0) continue;

            // Device name header
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`${deviceLabel}: ${section.deviceName}`, 14, y);
            y += 6;

            // Table for this device
            autoTable(doc, {
                startY: y,
                head: [
                    [
                        tableHeaders.entityName,
                        tableHeaders.unit,
                        tableHeaders.last,
                        tableHeaders.min,
                        tableHeaders.max,
                        tableHeaders.avg,
                    ],
                ],
                body: section.rows.map(r => [
                    r.entityName,
                    r.unit || '—',
                    fmt(r.last),
                    fmt(r.min),
                    fmt(r.max),
                    fmt(r.avg),
                ]),
                theme: 'grid',
                headStyles: { fillColor: [66, 139, 202], textColor: 255 },
                margin: { left: 14, right: 14 },
            });
            const tbl = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable;
            y = tbl?.finalY ?? y + 10;

            // Add spacing between device sections (except last)
            if (i < deviceSections.length - 1) {
                y += 5;
            }
        }
    }

    y += 10;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.text(`${generatedAtLabel} ${generatedAt}`, 14, y);
    y += 5;
    doc.text(ariotLabel, 14, y);

    return doc.output('blob');
}
