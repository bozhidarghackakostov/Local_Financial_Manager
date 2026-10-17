import React, { useState } from 'react';
import { Modal } from '../../components/dialogs/Modal.js';
import { AlertBanner, SignedAmountCell } from '../../components/feedback/Feedback.js';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  AppSettings,
  Category,
  CsvPreviewResult,
} from '../../../shared/types/index.js';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportCompleted: () => void;
  accounts: Account[];
  categories: Category[];
  settings: AppSettings;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen,
  onClose,
  onImportCompleted,
  accounts,
  categories,
  settings,
}) => {
  const activeAccounts = accounts.filter((a) => a.status === 'active');

  const [step, setStep] = useState<'select' | 'map' | 'preview' | 'done'>('select');
  const [filename, setFilename] = useState<string>('statement.csv');
  const [csvContent, setCsvContent] = useState<string>('');
  const [delimiter, setDelimiter] = useState<',' | ';' | '\t'>(',');
  const [accountId, setAccountId] = useState<string>(activeAccounts[0]?.id ?? '');

  const [headers, setHeaders] = useState<string[]>([]);
  const [dateColumn, setDateColumn] = useState<string>('');
  const [amountColumn, setAmountColumn] = useState<string>('');
  const [descriptionColumn, setDescriptionColumn] = useState<string>('');
  const [typeColumn, setTypeColumn] = useState<string>('');
  const [categoryColumn, setCategoryColumn] = useState<string>('');
  const [notesColumn, setNotesColumn] = useState<string>('');
  const [dateFormat, setDateFormat] = useState<'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'>('YYYY-MM-DD');
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');
  const [defaultCategoryId, setDefaultCategoryId] = useState<string>('');

  const [previewResult, setPreviewResult] = useState<CsvPreviewResult | null>(null);
  const [includeDuplicates, setIncludeDuplicates] = useState<boolean>(false);
  const [commitResult, setCommitResult] = useState<{
    importedCount: number;
    skippedCount: number;
    errorCount: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleReset = () => {
    setStep('select');
    setCsvContent('');
    setHeaders([]);
    setPreviewResult(null);
    setCommitResult(null);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCsvContent(reader.result);
      }
    };
    reader.readAsText(file);
  };

  const handleInspectColumns = async () => {
    setError(null);
    if (!accountId && activeAccounts[0]) {
      setAccountId(activeAccounts[0].id);
    }
    try {
      const inspected = await apiClient.inspectCsvHeaders(csvContent, delimiter);
      setHeaders(inspected.headers);
      // Auto-guess column names
      const findHeader = (keywords: string[]) =>
        inspected.headers.find((h) =>
          keywords.some((k) => h.toLowerCase().includes(k))
        ) ?? '';

      setDateColumn(findHeader(['date', 'day', 'time']) || inspected.headers[0] || '');
      setAmountColumn(findHeader(['amount', 'value', 'sum', 'total']) || inspected.headers[1] || '');
      setDescriptionColumn(
        findHeader(['desc', 'merchant', 'payee', 'memo', 'narrative', 'name']) ||
          inspected.headers[2] ||
          inspected.headers[0] ||
          ''
      );
      setTypeColumn(findHeader(['type', 'direction', 'dr/cr']));
      setCategoryColumn(findHeader(['category', 'class']));
      setNotesColumn(findHeader(['note', 'comment', 'reference']));
      setStep('map');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleGeneratePreview = async () => {
    setError(null);
    if (!accountId) {
      setError('Please select a target account.');
      return;
    }
    try {
      const preview = await apiClient.previewCsvImport({
        csvContent,
        accountId,
        delimiter,
        mapping: {
          dateColumn,
          amountColumn,
          descriptionColumn,
          typeColumn: typeColumn || undefined,
          categoryColumn: categoryColumn || undefined,
          notesColumn: notesColumn || undefined,
          dateFormat,
          decimalSeparator,
          defaultCategoryId: defaultCategoryId || undefined,
        },
      });
      setPreviewResult(preview);
      setStep('preview');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleCommitImport = async () => {
    if (!previewResult) return;
    setError(null);
    try {
      const validRows = previewResult.rows
        .filter((r) => r.valid && r.parsed)
        .map((r) => ({
          rowIndex: r.rowIndex,
          skip: false,
          isProbableDuplicate: r.isProbableDuplicate,
          ...r.parsed!,
        }));

      const res = await apiClient.commitCsvImport({
        sourceFilename: filename,
        accountId,
        includeDuplicates,
        rows: validRows,
      });
      setCommitResult(res);
      setStep('done');
      onImportCompleted();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Import Transactions from CSV"
      size="lg"
      onClose={() => {
        handleReset();
        onClose();
      }}
      footer={
        <>
          <button
            type="button"
            className="btn"
            onClick={() => {
              handleReset();
              onClose();
            }}
          >
            {step === 'done' ? 'Close' : 'Cancel'}
          </button>
          {step === 'select' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!csvContent.trim() || activeAccounts.length === 0}
              onClick={() => void handleInspectColumns()}
            >
              Next: Map Columns →
            </button>
          )}
          {step === 'map' && (
            <>
              <button type="button" className="btn" onClick={() => setStep('select')}>
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleGeneratePreview()}
              >
                Next: Preview & Validate →
              </button>
            </>
          )}
          {step === 'preview' && (
            <>
              <button type="button" className="btn" onClick={() => setStep('map')}>
                ← Back to Mapping
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!previewResult || previewResult.validCount === 0}
                onClick={() => void handleCommitImport()}
              >
                Confirm & Import Valid Rows
              </button>
            </>
          )}
        </>
      }
    >
      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}

      {step === 'select' && (
        <div>
          {activeAccounts.length === 0 && (
            <AlertBanner
              type="error"
              message="Create at least one active account before importing CSV transactions."
            />
          )}

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="csv-target-account">Target Account</label>
              <select
                id="csv-target-account"
                className="form-control"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">Select account...</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="csv-delimiter">Column Delimiter</label>
              <select
                id="csv-delimiter"
                className="form-control"
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as ',' | ';' | '\t')}
              >
                <option value=",">Comma (,)</option>
                <option value=";">Semicolon (;)</option>
                <option value={'\t'}>Tab</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="csv-file-input">1. Select Local CSV File</label>
            <input
              id="csv-file-input"
              type="file"
              accept=".csv,text/csv,text/plain"
              className="form-control"
              onChange={handleFileChange}
            />
          </div>

          <div className="form-group">
            <label htmlFor="csv-raw-textarea">Or Paste CSV Content Directly</label>
            <textarea
              id="csv-raw-textarea"
              rows={6}
              className="form-control"
              placeholder={'Date,Amount,Description,Category\n2026-10-15,-45.20,Supermarket,Groceries\n2026-10-16,1800.00,Client Deposit,Freelance'}
              value={csvContent}
              onChange={(e) => setCsvContent(e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
          </div>
        </div>
      )}

      {step === 'map' && (
        <div>
          <p style={{ marginTop: 0, fontSize: '13px', color: '#4b5563' }}>
            Map the columns from <strong>{filename}</strong> to LedgerDesk transaction fields.
          </p>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="map-date">Date Column *</label>
              <select
                id="map-date"
                className="form-control"
                value={dateColumn}
                onChange={(e) => setDateColumn(e.target.value)}
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-amount">Amount Column *</label>
              <select
                id="map-amount"
                className="form-control"
                value={amountColumn}
                onChange={(e) => setAmountColumn(e.target.value)}
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-desc">Description / Merchant Column *</label>
              <select
                id="map-desc"
                className="form-control"
                value={descriptionColumn}
                onChange={(e) => setDescriptionColumn(e.target.value)}
              >
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-cat">Category Column (optional)</label>
              <select
                id="map-cat"
                className="form-control"
                value={categoryColumn}
                onChange={(e) => setCategoryColumn(e.target.value)}
              >
                <option value="">-- None --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-type">Type Column (optional)</label>
              <select
                id="map-type"
                className="form-control"
                value={typeColumn}
                onChange={(e) => setTypeColumn(e.target.value)}
              >
                <option value="">-- Infer from +/- sign --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-notes">Notes Column (optional)</label>
              <select
                id="map-notes"
                className="form-control"
                value={notesColumn}
                onChange={(e) => setNotesColumn(e.target.value)}
              >
                <option value="">-- None --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="map-date-format">Date Format in CSV</label>
              <select
                id="map-date-format"
                className="form-control"
                value={dateFormat}
                onChange={(e) =>
                  setDateFormat(e.target.value as 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY')
                }
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD (e.g. 2026-10-17)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 17/10/2026)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (e.g. 10/17/2026)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-dec-sep">Decimal Separator</label>
              <select
                id="map-dec-sep"
                className="form-control"
                value={decimalSeparator}
                onChange={(e) => setDecimalSeparator(e.target.value as '.' | ',')}
              >
                <option value=".">Period (1250.50)</option>
                <option value=",">Comma (1250,50)</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="map-default-cat">Fallback Expense Category</label>
              <select
                id="map-default-cat"
                className="form-control"
                value={defaultCategoryId}
                onChange={(e) => setDefaultCategoryId(e.target.value)}
              >
                <option value="">Auto (Other Expense / Other Income)</option>
                {categories
                  .filter((c) => !c.is_archived)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.category_type})
                    </option>
                  ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {step === 'preview' && previewResult && (
        <div>
          <div
            style={{
              display: 'flex',
              gap: '16px',
              padding: '10px 14px',
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: '4px',
              marginBottom: '12px',
              fontSize: '13px',
            }}
          >
            <span>
              Total Rows: <strong>{previewResult.totalRows}</strong>
            </span>
            <span className="amount-positive">
              Valid Rows: <strong>{previewResult.validCount}</strong>
            </span>
            <span className="amount-negative">
              Invalid Rows: <strong>{previewResult.invalidCount}</strong>
            </span>
            <span style={{ color: '#b45309' }}>
              Probable Duplicates: <strong>{previewResult.duplicateCount}</strong>
            </span>
          </div>

          {previewResult.duplicateCount > 0 && (
            <div
              className="form-group"
              style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}
            >
              <input
                id="csv-include-duplicates"
                type="checkbox"
                checked={includeDuplicates}
                onChange={(e) => setIncludeDuplicates(e.target.checked)}
              />
              <label htmlFor="csv-include-duplicates" style={{ marginBottom: 0 }}>
                Import probable duplicates anyway (unchecked = safely skip probable duplicates)
              </label>
            </div>
          )}

          <div className="table-wrapper" style={{ maxHeight: '320px' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {previewResult.rows.map((row) => (
                  <tr key={row.rowIndex}>
                    <td>#{row.rowIndex}</td>
                    <td>
                      {!row.valid ? (
                        <span className="badge badge-danger" title={row.errors.join('; ')}>
                          [Invalid] {row.errors[0]}
                        </span>
                      ) : row.isProbableDuplicate ? (
                        <span className="badge badge-warning" title={row.duplicateReason}>
                          [Duplicate] {row.duplicateReason}
                        </span>
                      ) : (
                        <span className="badge badge-success">[Ready]</span>
                      )}
                    </td>
                    <td>{row.parsed?.transaction_date ?? '—'}</td>
                    <td>{row.parsed?.description ?? '—'}</td>
                    <td>{row.parsed?.category_name ?? '—'}</td>
                    <td className="num">
                      {row.parsed ? (
                        <SignedAmountCell
                          type={row.parsed.transaction_type}
                          amountMinor={row.parsed.amount_minor}
                          currency={settings.base_currency}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 'done' && commitResult && (
        <div style={{ padding: '16px 0' }}>
          <AlertBanner
            type="success"
            message={`CSV Import Completed: ${commitResult.importedCount} transaction(s) imported, ${commitResult.skippedCount} duplicate/skipped row(s) ignored.`}
          />
        </div>
      )}
    </Modal>
  );
};
