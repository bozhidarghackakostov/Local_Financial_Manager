import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  AppSettings,
  BackupMetadata,
  Category,
  CategoryType,
  DateFormatPreference,
  PeriodPreset,
} from '../../../shared/types/index.js';
import {
  DATE_FORMATS,
  PERIOD_PRESETS,
  SUPPORTED_CURRENCIES,
} from '../../../shared/constants/index.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import { AlertBanner } from '../../components/feedback/Feedback.js';
import { ConfirmDialog, Modal } from '../../components/dialogs/Modal.js';

interface SettingsViewProps {
  settings: AppSettings;
  categories: Category[];
  onDataMutated: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  categories,
  onDataMutated,
}) => {
  const [baseCurrency, setBaseCurrency] = useState<string>(settings.base_currency);
  const [dateFormat, setDateFormat] = useState<DateFormatPreference>(settings.date_format);
  const [defaultPeriod, setDefaultPeriod] = useState<PeriodPreset>(settings.default_period);

  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [backupLabel, setBackupLabel] = useState<string>('manual');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Category modal state
  const [isCatModalOpen, setIsCatModalOpen] = useState<boolean>(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [catName, setCatName] = useState<string>('');
  const [catType, setCatType] = useState<CategoryType>('expense');
  const [catOrder, setCatOrder] = useState<number>(10);

  // Delete category with reassignment modal
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [reassignTargetId, setReassignTargetId] = useState<string>('');

  // Confirm restore dialog
  const [confirmRestoreFilename, setConfirmRestoreFilename] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      const list = await apiClient.getBackups();
      setBackups(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setBaseCurrency(settings.base_currency);
    setDateFormat(settings.date_format);
    setDefaultPeriod(settings.default_period);
  }, [settings]);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await apiClient.updateSettings({
        base_currency: baseCurrency,
        date_format: dateFormat,
        default_period: defaultPeriod,
      });
      setFeedback('Saved application preferences.');
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const openCreateCategory = (type: CategoryType) => {
    setEditingCategory(null);
    setCatName('');
    setCatType(type);
    setCatOrder(10);
    setError(null);
    setIsCatModalOpen(true);
  };

  const openEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatType(cat.category_type);
    setCatOrder(cat.display_order);
    setError(null);
    setIsCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (editingCategory) {
        await apiClient.updateCategory(editingCategory.id, {
          name: catName.trim(),
          display_order: catOrder,
        });
        setFeedback(`Updated category "${catName.trim()}".`);
      } else {
        await apiClient.createCategory({
          name: catName.trim(),
          category_type: catType,
          display_order: catOrder,
        });
        setFeedback(`Created ${catType} category "${catName.trim()}".`);
      }
      setIsCatModalOpen(false);
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggleArchiveCategory = async (cat: Category) => {
    try {
      await apiClient.updateCategory(cat.id, { is_archived: !cat.is_archived });
      setFeedback(
        !cat.is_archived
          ? `Archived category "${cat.name}".`
          : `Unarchived category "${cat.name}".`
      );
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleConfirmDeleteCategory = async () => {
    if (!deletingCategory) return;
    try {
      await apiClient.deleteCategory(
        deletingCategory.id,
        reassignTargetId || undefined
      );
      setFeedback(`Deleted category "${deletingCategory.name}".`);
      setDeletingCategory(null);
      setReassignTargetId('');
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
      setDeletingCategory(null);
    }
  };

  const handleCreateBackup = async () => {
    setError(null);
    try {
      const meta = await apiClient.createBackup(backupLabel || 'manual');
      setFeedback(`Created verified SQLite backup: ${meta.filename}`);
      void loadBackups();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRestoreConfirmed = async () => {
    if (!confirmRestoreFilename) return;
    setError(null);
    try {
      const res = await apiClient.restoreBackupByFilename(confirmRestoreFilename);
      setFeedback(
        `Database restored from "${res.restoredFrom}". Pre-restore safety snapshot saved as "${res.safetyBackupFilename}".`
      );
      setConfirmRestoreFilename(null);
      onDataMutated();
      void loadBackups();
    } catch (err) {
      setError((err as Error).message);
      setConfirmRestoreFilename(null);
    }
  };

  const handleUploadBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arrayBuf = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(arrayBuf);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = window.btoa(binary);
        const res = await apiClient.restoreBackupFromBase64(base64, file.name);
        setFeedback(
          `Uploaded and restored database from "${file.name}". Pre-restore safety snapshot saved as "${res.safetyBackupFilename}".`
        );
        onDataMutated();
        void loadBackups();
      } catch (err) {
        setError((err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const expenseCategories = categories.filter((c) => c.category_type === 'expense');
  const incomeCategories = categories.filter((c) => c.category_type === 'income');

  return (
    <div>
      <PageHeader
        title="Application Settings & Data Management"
        description="Manage currency and display preferences, organize income and expense categories, export portable data, and manage SQLite backups."
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">General Preferences</h3>
          </div>
          <div className="panel-body">
            <form onSubmit={handleSavePreferences}>
              <div className="form-group">
                <label htmlFor="pref-currency">Base Currency</label>
                <select
                  id="pref-currency"
                  className="form-control"
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol}) — {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="pref-date-format">Preferred Date Format</label>
                <select
                  id="pref-date-format"
                  className="form-control"
                  value={dateFormat}
                  onChange={(e) => setDateFormat(e.target.value as DateFormatPreference)}
                >
                  {DATE_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="pref-period">Default Dashboard Period</label>
                <select
                  id="pref-period"
                  className="form-control"
                  value={defaultPeriod}
                  onChange={(e) => setDefaultPeriod(e.target.value as PeriodPreset)}
                >
                  {PERIOD_PRESETS.filter((p) => p.value !== 'custom').map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <button type="submit" className="btn btn-primary">
                Save Preferences
              </button>
            </form>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Portable Data Export</h3>
          </div>
          <div className="panel-body">
            <p style={{ marginTop: 0, fontSize: '13px', color: '#4b5563' }}>
              You own 100% of your financial data. Export your records in standard open formats at any time.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
              <a href="/api/export/transactions.csv" className="btn btn-primary" download>
                Download Transactions (CSV)
              </a>
              <a href="/api/export/full.json" className="btn" download>
                Download Full Structured Archive (JSON)
              </a>
            </div>
            <div style={{ fontSize: '12px', color: '#6b7280', borderTop: '1px solid #e5e7eb', paddingTop: '10px' }}>
              <strong>Local Storage Notice:</strong> Your database is stored locally in{' '}
              <code>data/ledgerdesk.sqlite</code>. The database file is unencrypted on disk; rely on your operating system account security and full-disk encryption (e.g. FileVault / BitLocker) to protect local files at rest.
            </div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">SQLite Database Backup & Recovery</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              className="form-control"
              placeholder="Backup label (e.g. monthly-close)"
              value={backupLabel}
              onChange={(e) => setBackupLabel(e.target.value)}
              style={{ width: '190px' }}
              aria-label="Backup Label"
            />
            <button type="button" className="btn btn-primary" onClick={() => void handleCreateBackup()}>
              + Create Database Backup Now
            </button>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <label htmlFor="upload-backup-input" style={{ fontSize: '13px', fontWeight: 600 }}>
              Restore from an external <code>.sqlite</code> backup file:
            </label>
            <input
              id="upload-backup-input"
              type="file"
              accept=".sqlite,.db"
              className="form-control"
              onChange={handleUploadBackupFile}
            />
          </div>

          {backups.length === 0 ? (
            <div style={{ color: '#6b7280', fontSize: '13px' }}>
              No local backups created yet. Click &ldquo;+ Create Database Backup Now&rdquo; to generate a verified snapshot in <code>data/backups/</code>.
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Backup Filename</th>
                    <th>Created Timestamp</th>
                    <th className="num">Size (Bytes)</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.filename}>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{b.filename}</td>
                      <td>{b.createdAt}</td>
                      <td className="num">{b.sizeBytes.toLocaleString()} B</td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <a
                            href={`/api/backup/${encodeURIComponent(b.filename)}/download`}
                            className="btn btn-sm"
                            download
                          >
                            Download .sqlite
                          </a>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setConfirmRestoreFilename(b.filename)}
                          >
                            Restore This Backup
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Expense Categories ({expenseCategories.length})</h3>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => openCreateCategory('expense')}
            >
              + Add Expense Category
            </button>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Order</th>
                  <th className="num">Transactions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenseCategories.map((cat) => (
                  <tr key={cat.id}>
                    <td>
                      <strong>{cat.name}</strong>
                    </td>
                    <td className="num">{cat.display_order}</td>
                    <td className="num">{cat.transaction_count ?? 0}</td>
                    <td>
                      {cat.is_archived ? (
                        <span className="badge badge-neutral">Archived</span>
                      ) : (
                        <span className="badge badge-success">Active</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditCategory(cat)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleToggleArchiveCategory(cat)}
                        >
                          {cat.is_archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            setDeletingCategory(cat);
                            const fallback = expenseCategories.find((c) => c.id !== cat.id);
                            setReassignTargetId(fallback?.id ?? '');
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Income Categories ({incomeCategories.length})</h3>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => openCreateCategory('income')}
            >
              + Add Income Category
            </button>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Order</th>
                  <th className="num">Transactions</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {incomeCategories.map((cat) => (
                  <tr key={cat.id}>
                    <td>
                      <strong>{cat.name}</strong>
                    </td>
                    <td className="num">{cat.display_order}</td>
                    <td className="num">{cat.transaction_count ?? 0}</td>
                    <td>
                      {cat.is_archived ? (
                        <span className="badge badge-neutral">Archived</span>
                      ) : (
                        <span className="badge badge-success">Active</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditCategory(cat)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleToggleArchiveCategory(cat)}
                        >
                          {cat.is_archived ? 'Unarchive' : 'Archive'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => {
                            setDeletingCategory(cat);
                            const fallback = incomeCategories.find((c) => c.id !== cat.id);
                            setReassignTargetId(fallback?.id ?? '');
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <Modal
        isOpen={isCatModalOpen}
        title={editingCategory ? 'Edit Category' : `Create ${catType} Category`}
        onClose={() => setIsCatModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setIsCatModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="category-form" className="btn btn-primary">
              {editingCategory ? 'Save Changes' : 'Create Category'}
            </button>
          </>
        }
      >
        <form id="category-form" onSubmit={handleSaveCategory}>
          <div className="form-group">
            <label htmlFor="cat-name">Category Name</label>
            <input
              id="cat-name"
              type="text"
              className="form-control"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="cat-order">Display Order</label>
            <input
              id="cat-order"
              type="number"
              min={0}
              className="form-control"
              value={catOrder}
              onChange={(e) => setCatOrder(Number(e.target.value) || 0)}
            />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(deletingCategory)}
        title={`Delete Category "${deletingCategory?.name}"`}
        onClose={() => setDeletingCategory(null)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setDeletingCategory(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void handleConfirmDeleteCategory()}
            >
              Delete Category
            </button>
          </>
        }
      >
        {deletingCategory && (
          <div>
            <p style={{ marginTop: 0 }}>
              If any transactions, budgets, or recurring rules use{' '}
              <strong>{deletingCategory.name}</strong>, select a replacement category below so
              financial history is preserved:
            </p>
            <div className="form-group">
              <label htmlFor="reassign-cat-select">Reassign Existing Records To</label>
              <select
                id="reassign-cat-select"
                className="form-control"
                value={reassignTargetId}
                onChange={(e) => setReassignTargetId(e.target.value)}
              >
                {categories
                  .filter(
                    (c) =>
                      c.category_type === deletingCategory.category_type &&
                      c.id !== deletingCategory.id
                  )
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirmRestoreFilename)}
        title="Restore SQLite Database Backup"
        message={`Restoring "${confirmRestoreFilename}" will replace current active records with the backup snapshot. LedgerDesk will automatically create a pre-restore safety backup of your current database before replacing it. Proceed?`}
        confirmLabel="Confirm & Restore Database"
        onConfirm={() => void handleRestoreConfirmed()}
        onCancel={() => setConfirmRestoreFilename(null)}
      />
    </div>
  );
};
