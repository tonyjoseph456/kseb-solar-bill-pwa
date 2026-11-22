import type { BillRecord, ZoneKey } from '../types';

export function sanitizeImageFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'solar-image'}.png`;
}

export async function downloadCanvasAsPng(
  canvas: HTMLCanvasElement,
  filename: string
): Promise<void> {
  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );

  if (pngBlob) {
    const dlUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(dlUrl), 1000);
  } else {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif';

const ZONE_LABELS: { key: ZoneKey; name: string }[] = [
  { key: 'NL', name: 'Normal (NL / WNL)' },
  { key: 'OP', name: 'Off Peak (OP / WOP)' },
  { key: 'PK', name: 'Peak (PK / WPK)' },
];

export async function exportBillRecordAsPng(record: BillRecord): Promise<void> {
  const isCumulative = record.meteringMode === 'cumulative';
  const readingRows: {
    channel: string;
    zone: string;
    ir: number;
    fr: number;
    units: number;
  }[] = [];

  for (const group of ['import', 'export', 'generation'] as const) {
    const channelLabel =
      group === 'import' ? 'Net Import' : group === 'export' ? 'Net Export' : 'Solar Gen';
    const zones = isCumulative
      ? [{ key: 'NL' as ZoneKey, name: group === 'generation' ? 'Cumulative (WAL)' : 'Cumulative' }]
      : ZONE_LABELS;
    for (const z of zones) {
      const item = record.readings[group][z.key];
      readingRows.push({
        channel: channelLabel,
        zone: z.name,
        ir: item.ir,
        fr: item.fr,
        units: item.units,
      });
    }
  }

  const chargeRows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Fixed Charge', value: `₹ ${record.summary.fixedCharge.toFixed(2)}` },
    {
      label: `Energy Charge (${record.summary.billedUnits} billed units)`,
      value: `₹ ${record.summary.energyCharge.toFixed(2)}`,
    },
    { label: 'Fuel Surcharge', value: `₹ ${record.summary.fuelSurcharge.toFixed(2)}` },
    { label: 'Electricity Duty', value: `₹ ${record.summary.electricityDuty.toFixed(2)}` },
    { label: 'Round Off', value: record.summary.roundOff.toFixed(2) },
    {
      label: 'Total Bill Amount',
      value: `₹ ${record.summary.totalAmount.toFixed(2)}`,
      bold: true,
    },
  ];

  const logicalW = 780;
  const padX = 28;
  const padTop = 26;
  const padBottom = 26;
  const contentW = logicalW - padX * 2;
  const headerBlockH = 56;
  const sectionTitleH = 30;
  const tableHeaderH = 34;
  const rowH = 34;
  const gapBetweenSections = 18;

  const logicalH =
    padTop +
    headerBlockH +
    sectionTitleH +
    tableHeaderH +
    readingRows.length * rowH +
    gapBetweenSections +
    sectionTitleH +
    chargeRows.length * rowH +
    padBottom;

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = logicalW * scale;
  canvas.height = logicalH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.scale(scale, scale);

  // Crisp white card background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, logicalW, logicalH);

  let y = padTop;

  // Title & Consumer metadata
  const titleText = `${record.billingLabel} — ${
    record.recordType === 'official_bill' ? 'Official KSEB PDF Bill' : 'Saved Meter Calculation'
  }${isCumulative ? ' [Cumulative]' : ''}`;
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 18px ${FONT_STACK}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(titleText, padX, y + 10, contentW);

  const subText = `Consumer: ${record.consumerName || '—'} (${record.consumerNo || '—'}) • Phase: ${
    record.tariffPhase
  } • Mode: ${isCumulative ? 'Cumulative (Pre-Oct 2025)' : 'ToD'} • Bank Opening: ${
    record.bankOpening
  } → Closing: ${record.bankClosing}`;
  ctx.fillStyle = '#64748b';
  ctx.font = `500 12.5px ${FONT_STACK}`;
  ctx.fillText(subText, padX, y + 34, contentW);

  y += headerBlockH;

  // Readings Section Title
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 14.5px ${FONT_STACK}`;
  ctx.fillText(
    isCumulative
      ? 'Cumulative Meter Readings & Consumption'
      : 'Zone-Wise Meter Readings & Consumption',
    padX,
    y + 14,
    contentW
  );
  y += sectionTitleH;

  // Readings Table Header
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(padX, y, contentW, tableHeaderH);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padX, y + tableHeaderH);
  ctx.lineTo(padX + contentW, y + tableHeaderH);
  ctx.stroke();

  const colChannel = padX + 12;
  const colZone = padX + 150;
  const colIr = padX + 445;
  const colFr = padX + 575;
  const colUnits = padX + contentW - 12;

  ctx.fillStyle = '#475569';
  ctx.font = `700 11px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('CHANNEL', colChannel, y + tableHeaderH / 2);
  ctx.fillText('ZONE', colZone, y + tableHeaderH / 2);
  ctx.textAlign = 'right';
  ctx.fillText('INITIAL (IR)', colIr, y + tableHeaderH / 2);
  ctx.fillText('FINAL (FR)', colFr, y + tableHeaderH / 2);
  ctx.fillText('UNITS (KWH)', colUnits, y + tableHeaderH / 2);
  y += tableHeaderH;

  // Readings Rows
  for (const row of readingRows) {
    const cy = y + rowH / 2;
    ctx.fillStyle = '#1e293b';
    ctx.font = `500 13px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(row.channel, colChannel, cy);
    ctx.fillText(row.zone, colZone, cy);
    ctx.textAlign = 'right';
    ctx.fillText(String(row.ir), colIr, cy);
    ctx.fillText(String(row.fr), colFr, cy);
    ctx.fillStyle = '#0f172a';
    ctx.font = `700 13px ${FONT_STACK}`;
    ctx.fillText(String(row.units), colUnits, cy);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(padX + contentW, y + rowH);
    ctx.stroke();
    y += rowH;
  }

  y += gapBetweenSections;

  // Charge Summary Section Title
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 14.5px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.fillText('Charge Summary', padX, y + 14, contentW);
  y += sectionTitleH;

  // Charge Summary Rows
  for (const c of chargeRows) {
    const cy = y + rowH / 2;
    if (c.bold) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(padX, y, contentW, rowH);
    }
    ctx.fillStyle = c.bold ? '#0f172a' : '#1e293b';
    ctx.font = `${c.bold ? '700' : '500'} 13.5px ${FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.fillText(c.label, colChannel, cy);
    ctx.textAlign = 'right';
    ctx.fillText(c.value, colUnits, cy);

    ctx.strokeStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.moveTo(padX, y + rowH);
    ctx.lineTo(padX + contentW, y + rowH);
    ctx.stroke();
    y += rowH;
  }

  const filename = sanitizeImageFilename(
    `kseb-bill-${record.billingMonth}-${record.recordType === 'official_bill' ? 'pdf' : 'estimate'}`
  );
  await downloadCanvasAsPng(canvas, filename);
}
