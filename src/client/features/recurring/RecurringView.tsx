import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  AppSettings,
  Category,
  RecurringFrequency,
  RecurringOccurrence,
  RecurringRule,
} from '../../../shared/types/index.js';
import { RECURRING_FREQUENCIES } from '../../../shared/constants/index.js';
import {
  formatMinorUnits,
  minorUnitsToDecimalString,
  parseDecimalToMinorUnits,
} from '../../../shared/utils/money.js';
import { formatDisplayDate, getTodayIsoDate } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import {
  AlertBanner,
  EmptyState,
  SignedAmountCell,
  TransactionTypeBadge,
} from '../../components/feedback/Feedback.js';
import { Modal } from '../../components/dialogs/Modal.js';

interface RecurringViewProps {
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  refreshTrigger: number;
  onDataMutated: () => void;
}

export const RecurringView: React.FC<RecurringViewProps> = ({
  settings,
  accounts,
  categories,
  refreshTrigger,
  onDataMutated,
}) => {
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [occurrences, setOccurrences] = useState<RecurringOccurrence[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [name, setName] = useState<string>('');
  const [txType, setTxType] = useState<'income' | 'expense'>('expense');
  const [amountInput, setAmountInput] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [intervalCount, setIntervalCount] = useState<number>(1);
  const [startDate, setStartDate] = useState<string>(getTodayIsoDate());
  const [endDate, setEndDate] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const eligibleCategories = categories.filter(
    (c) => c.category_type === txType && !c.is_archived
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getRecurring();
      setRules(res.rules);
      setOccurrences(res.occurrences);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshTrigger]);

  const openCreateModal = () => {
    setEditingRule(null);
    setName('');
    setTxType('expense');
    setAmountInput('');
    setAccountId(activeAccounts[0]?.id ?? '');
    const firstExpCat = categories.find((c) => c.category_type === 'expense' && !c.is_archived);
    setCategoryId(firstExpCat?.id ?? '');
    setFrequency('monthly');
    setIntervalCount(1);
    setStartDate(getTodayIsoDate());
    setEndDate('');
    setDescription('');
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (rule: RecurringRule) => {
    setEditingRule(rule);
    setName(rule.name);
    setTxType(rule.transaction_type);
    setAmountInput(minorUnitsToDecimalString(rule.amount_minor));
    setAccountId(rule.account_id);
    setCategoryId(rule.category_id);
    setFrequency(rule.frequency);
    setIntervalCount(rule.interval_count);
    setStartDate(rule.start_date);
    setEndDate(rule.end_date ?? '');
    setDescription(rule.description);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let amountMinor: number;
    try {
      amountMinor = parseDecimalToMinorUnits(amountInput, {
        allowNegative: false,
        allowZero: false,
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    try {
      if (editingRule) {
        await apiClient.updateRecurringRule(editingRule.id, {
          name: name.trim(),
          amount_minor: amountMinor,
          account_id: accountId,
          category_id: categoryId,
          description: description.trim(),
          frequency,
          interval_count: intervalCount,
          end_date: endDate || null,
        });
        setFeedback(`Updated recurring schedule "${name.trim()}".`);
      } else {
        await apiClient.createRecurringRule({
          name: name.trim(),
          transaction_type: txType,
          amount_minor: amountMinor,
          account_id: accountId,
          category_id: categoryId,
          description: description.trim(),
          frequency,
          interval_count: intervalCount,
          start_date: startDate,
          end_date: endDate || null,
        });
        setFeedback(`Created recurring schedule "${name.trim()}".`);
      }
      setIsModalOpen(false);
      onDataMutated();
      void loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRuleStatusChange = async (
    rule: RecurringRule,
    nextStatus: 'active' | 'paused' | 'cancelled'
  ) => {
    try {
      await apiClient.updateRecurringRule(rule.id, { status: nextStatus });
      setFeedback(`Updated "${rule.name}" status to ${nextStatus}.`);
      onDataMutated();
      void loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleConfirmOccurrence = async (occ: RecurringOccurrence) => {
    try {
      await apiClient.confirmOccurrence(occ.id);
      setFeedback(
        `Confirmed "${occ.rule_name}" (${occ.due_date}) and posted transaction to ${occ.account_name}.`
      );
      onDataMutated();
      void loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSkipOccurrence = async (occ: RecurringOccurrence) => {
    try {
      await apiClient.skipOccurrence(occ.id);
      setFeedback(`Skipped occurrence "${occ.rule_name}" for ${occ.due_date}.`);
      onDataMutated();
      void loadData();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pendingOccurrences = occurrences.filter((o) => o.status === 'pending');
  const historyOccurrences = occurrences.filter((o) => o.status !== 'pending');

  return (
    <div>
      <PageHeader
        title="Recurring Payments & Schedules"
        description="Track bills, subscriptions, and expected recurring income. Due occurrences require your explicit confirmation before posting to the ledger."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            + New Recurring Schedule
          </button>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">
            Pending & Upcoming Occurrences ({pendingOccurrences.length})
          </h3>
        </div>
        {pendingOccurrences.length === 0 ? (
          <EmptyState
            title="No pending recurring occurrences"
            description="When a recurring rule has upcoming or overdue items, they appear here for one-click confirmation."
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Due Date</th>
                  <th>Urgency</th>
                  <th>Schedule Name</th>
                  <th>Type</th>
                  <th>Account & Category</th>
                  <th className="num">Expected Amount</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingOccurrences.map((occ) => (
                  <tr key={occ.id}>
                    <td>
                      <strong>{formatDisplayDate(occ.due_date, settings.date_format)}</strong>
                    </td>
                    <td>
                      {occ.urgency === 'overdue' && (
                        <span className="badge badge-danger">[!] Overdue / Missed</span>
                      )}
                      {occ.urgency === 'due_soon' && (
                        <span className="badge badge-warning">[Due Soon]</span>
                      )}
                      {occ.urgency === 'upcoming' && (
                        <span className="badge badge-neutral">Upcoming</span>
                      )}
                    </td>
                    <td>{occ.rule_name}</td>
                    <td>
                      <TransactionTypeBadge type={occ.transaction_type} />
                    </td>
                    <td>
                      {occ.account_name} · {occ.category_name}
                    </td>
                    <td className="num">
                      <SignedAmountCell
                        type={occ.transaction_type}
                        amountMinor={occ.expected_amount_minor}
                        currency={settings.base_currency}
                      />
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => void handleConfirmOccurrence(occ)}
                        >
                          Confirm & Post to Ledger
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleSkipOccurrence(occ)}
                        >
                          Skip
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Recurring Rules ({rules.length})</h3>
        </div>
        {loading && rules.length === 0 ? (
          <div className="panel-body">Loading recurring schedules...</div>
        ) : rules.length === 0 ? (
          <EmptyState
            title="No recurring schedules defined"
            description="Create a schedule for monthly rent, utilities, subscriptions, or salary."
            actionLabel="+ New Recurring Schedule"
            onAction={openCreateModal}
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Schedule</th>
                  <th>Account / Category</th>
                  <th>Next Due</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.name}</strong>
                      {r.description && (
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>{r.description}</div>
                      )}
                    </td>
                    <td>
                      <TransactionTypeBadge type={r.transaction_type} />
                    </td>
                    <td>
                      Every {r.interval_count > 1 ? `${r.interval_count} ` : ''}
                      {r.frequency} (from {formatDisplayDate(r.start_date, settings.date_format)})
                    </td>
                    <td>
                      {r.account_name} · {r.category_name}
                    </td>
                    <td>{formatDisplayDate(r.next_due_date, settings.date_format)}</td>
                    <td className="num">
                      {formatMinorUnits(r.amount_minor, settings.base_currency)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          r.status === 'active'
                            ? 'badge-success'
                            : r.status === 'paused'
                              ? 'badge-warning'
                              : 'badge-neutral'
                        }`}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditModal(r)}
                        >
                          Edit
                        </button>
                        {r.status === 'active' && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void handleRuleStatusChange(r, 'paused')}
                          >
                            Pause
                          </button>
                        )}
                        {r.status === 'paused' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onClick={() => void handleRuleStatusChange(r, 'active')}
                          >
                            Resume
                          </button>
                        )}
                        {r.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void handleRuleStatusChange(r, 'cancelled')}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {historyOccurrences.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">
              Recorded & Skipped Occurrence History ({historyOccurrences.length})
            </h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Due Date</th>
                  <th>Schedule Name</th>
                  <th className="num">Amount</th>
                  <th>Resolution</th>
                  <th>Linked Transaction ID</th>
                </tr>
              </thead>
              <tbody>
                {historyOccurrences.map((occ) => (
                  <tr key={occ.id}>
                    <td>{formatDisplayDate(occ.due_date, settings.date_format)}</td>
                    <td>{occ.rule_name}</td>
                    <td className="num">
                      {formatMinorUnits(occ.expected_amount_minor, settings.base_currency)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          occ.status === 'confirmed' ? 'badge-success' : 'badge-neutral'
                        }`}
                      >
                        {occ.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                      {occ.linked_transaction_id ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        isOpen={isModalOpen}
        title={editingRule ? 'Edit Recurring Rule' : 'Create Recurring Schedule'}
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="recurring-form" className="btn btn-primary">
              {editingRule ? 'Save Changes' : 'Create Schedule'}
            </button>
          </>
        }
      >
        <form id="recurring-form" onSubmit={handleSaveRule}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="rec-name">Schedule Name</label>
              <input
                id="rec-name"
                type="text"
                className="form-control"
                placeholder="e.g., Apartment Rent, Fiber Internet, Salary"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            {!editingRule && (
              <div className="form-group">
                <label htmlFor="rec-type">Transaction Type</label>
                <select
                  id="rec-type"
                  className="form-control"
                  value={txType}
                  onChange={(e) => {
                    const next = e.target.value as 'income' | 'expense';
                    setTxType(next);
                    const firstCat = categories.find(
                      (c) => c.category_type === next && !c.is_archived
                    );
                    setCategoryId(firstCat?.id ?? '');
                  }}
                >
                  <option value="expense">Expense (-)</option>
                  <option value="income">Income (+)</option>
                </select>
              </div>
            )}
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="rec-amount">Amount ({settings.base_currency})</label>
              <input
                id="rec-amount"
                type="text"
                inputMode="decimal"
                className="form-control"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="rec-account">Account</label>
              <select
                id="rec-account"
                className="form-control"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="">Select account...</option>
                {activeAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="rec-category">Category</label>
              <select
                id="rec-category"
                className="form-control"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                required
              >
                <option value="">Select category...</option>
                {eligibleCategories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="rec-freq">Recurrence Frequency</label>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="form-control"
                  style={{ width: '70px' }}
                  value={intervalCount}
                  onChange={(e) => setIntervalCount(Number(e.target.value) || 1)}
                  aria-label="Recurrence Interval"
                />
                <select
                  id="rec-freq"
                  className="form-control"
                  style={{ flex: 1 }}
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                >
                  {RECURRING_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="form-grid">
            {!editingRule && (
              <div className="form-group">
                <label htmlFor="rec-start">Start Date</label>
                <input
                  id="rec-start"
                  type="date"
                  className="form-control"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
            )}

            <div className="form-group">
              <label htmlFor="rec-end">End Date (optional)</label>
              <input
                id="rec-end"
                type="date"
                className="form-control"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="rec-desc">Description (optional)</label>
            <input
              id="rec-desc"
              type="text"
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </Modal>
    </div>
  );
};
