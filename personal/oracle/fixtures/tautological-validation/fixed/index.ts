export interface CreditNoteLine {
  sku: string;
  amount: number;
}

export interface StoredDocument {
  id: string;
  kind: 'invoice' | 'credit-note';
  sourceKey: string;
  lines: CreditNoteLine[];
  totalAmount: number;
  errorMessage: string;
}

export interface RefundReader {
  refundTotal(sourceKey: string): number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function validateDocument(
  doc: StoredDocument,
  opts: { totalAmount: number },
): { valid: boolean; errors: string[] } {
  const lineSum = round2(doc.lines.reduce((sum, l) => sum + l.amount, 0));
  const errors = Math.abs(lineSum - opts.totalAmount) < 0.01
    ? []
    : ['document total does not match what the customer was charged'];
  return { valid: errors.length === 0, errors };
}

export function chargedTotalForRetry(doc: StoredDocument, reader: RefundReader): number {
  if (doc.kind === 'credit-note') return reader.refundTotal(doc.sourceKey);
  return doc.totalAmount;
}

export function retryTransmission(
  doc: StoredDocument,
  reader: RefundReader,
): { transmitted: boolean; reason: string } {
  const totalAmount = chargedTotalForRetry(doc, reader);
  const verdict = validateDocument(doc, { totalAmount });
  return {
    transmitted: verdict.valid,
    reason: verdict.valid ? 'validation passed' : verdict.errors.join('; '),
  };
}
