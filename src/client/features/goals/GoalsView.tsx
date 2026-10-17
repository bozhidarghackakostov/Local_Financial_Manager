import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  AppSettings,
  SavingsContribution,
  SavingsGoal,
} from '../../../shared/types/index.js';
import {
  formatMinorUnits,
  minorUnitsToDecimalString,
  parseDecimalToMinorUnits,
} from '../../../shared/utils/money.js';
import { formatDisplayDate, getTodayIsoDate } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import { AlertBanner, EmptyState } from '../../components/feedback/Feedback.js';
import { ConfirmDialog, Modal } from '../../components/dialogs/Modal.js';

interface GoalsViewProps {
  settings: AppSettings;
  accounts: Account[];
  refreshTrigger: number;
  onDataMutated: () => void;
}

export const GoalsView: React.FC<GoalsViewProps> = ({
  settings,
  accounts,
  refreshTrigger,
  onDataMutated,
}) => {
  const [goals, setGoals] = useState<SavingsGoal[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [isGoalModalOpen, setIsGoalModalOpen] = useState<boolean>(false);
  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [name, setName] = useState<string>('');
  const [targetInput, setTargetInput] = useState<string>('');
  const [initialContribInput, setInitialContribInput] = useState<string>('0.00');
  const [targetDate, setTargetDate] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [description, setDescription] = useState<string>('');

  const [selectedGoalDetail, setSelectedGoalDetail] = useState<
    (SavingsGoal & { contributions: SavingsContribution[] }) | null
  >(null);
  const [contribAmountInput, setContribAmountInput] = useState<string>('');
  const [contribDate, setContribDate] = useState<string>(getTodayIsoDate());
  const [contribNotes, setContribNotes] = useState<string>('');
  const [confirmDeleteGoal, setConfirmDeleteGoal] = useState<SavingsGoal | null>(null);

  const loadGoals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiClient.getGoals();
      setGoals(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals, refreshTrigger]);

  const openCreateModal = () => {
    setEditingGoal(null);
    setName('');
    setTargetInput('');
    setInitialContribInput('0.00');
    setTargetDate('');
    setAccountId('');
    setDescription('');
    setError(null);
    setIsGoalModalOpen(true);
  };

  const openEditModal = (g: SavingsGoal) => {
    setEditingGoal(g);
    setName(g.name);
    setTargetInput(minorUnitsToDecimalString(g.target_amount_minor));
    setTargetDate(g.target_date ?? '');
    setAccountId(g.account_id ?? '');
    setDescription(g.description);
    setError(null);
    setIsGoalModalOpen(true);
  };

  const openContributionsDrawer = async (goalId: string) => {
    try {
      const detail = await apiClient.getGoalById(goalId);
      setSelectedGoalDetail(detail);
      setContribAmountInput('');
      setContribDate(getTodayIsoDate());
      setContribNotes('');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let targetMinor: number;
    let initialMinor = 0;
    try {
      targetMinor = parseDecimalToMinorUnits(targetInput, {
        allowNegative: false,
        allowZero: false,
      });
      if (!editingGoal && initialContribInput.trim()) {
        initialMinor = parseDecimalToMinorUnits(initialContribInput, {
          allowNegative: false,
          allowZero: true,
        });
      }
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    try {
      if (editingGoal) {
        await apiClient.updateGoal(editingGoal.id, {
          name: name.trim(),
          target_amount_minor: targetMinor,
          target_date: targetDate || null,
          account_id: accountId || null,
          description: description.trim(),
        });
        setFeedback(`Updated savings goal "${name.trim()}".`);
      } else {
        await apiClient.createGoal({
          name: name.trim(),
          target_amount_minor: targetMinor,
          target_date: targetDate || null,
          account_id: accountId || null,
          description: description.trim(),
          initial_contribution_minor: initialMinor,
        });
        setFeedback(`Created savings goal "${name.trim()}".`);
      }
      setIsGoalModalOpen(false);
      onDataMutated();
      void loadGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleAddContribution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGoalDetail) return;
    setError(null);

    let amountMinor: number;
    try {
      amountMinor = parseDecimalToMinorUnits(contribAmountInput, {
        allowNegative: true,
        allowZero: false,
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    try {
      await apiClient.addGoalContribution(selectedGoalDetail.id, {
        amount_minor: amountMinor,
        contribution_date: contribDate,
        notes: contribNotes.trim(),
      });
      setContribAmountInput('');
      setContribNotes('');
      const refreshed = await apiClient.getGoalById(selectedGoalDetail.id);
      setSelectedGoalDetail(refreshed);
      onDataMutated();
      void loadGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteContribution = async (contributionId: string) => {
    if (!selectedGoalDetail) return;
    try {
      await apiClient.deleteGoalContribution(selectedGoalDetail.id, contributionId);
      const refreshed = await apiClient.getGoalById(selectedGoalDetail.id);
      setSelectedGoalDetail(refreshed);
      onDataMutated();
      void loadGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleStatusChange = async (
    goal: SavingsGoal,
    status: 'active' | 'completed' | 'archived'
  ) => {
    try {
      await apiClient.updateGoal(goal.id, { status });
      setFeedback(`Marked "${goal.name}" as ${status}.`);
      onDataMutated();
      void loadGoals();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteGoal = async () => {
    if (!confirmDeleteGoal) return;
    try {
      await apiClient.deleteGoal(confirmDeleteGoal.id);
      setFeedback(`Deleted savings goal "${confirmDeleteGoal.name}".`);
      setConfirmDeleteGoal(null);
      onDataMutated();
      void loadGoals();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDeleteGoal(null);
    }
  };

  const totalTarget = goals
    .filter((g) => g.status !== 'archived')
    .reduce((s, g) => s + g.target_amount_minor, 0);
  const totalSaved = goals
    .filter((g) => g.status !== 'archived')
    .reduce((s, g) => s + g.current_amount_minor, 0);

  return (
    <div>
      <PageHeader
        title="Savings Goals"
        description="Track target amounts, contribution history, and progress. Goal allocations are tracked independently so account balances are never double-deducted."
        actions={
          <button type="button" className="btn btn-primary" onClick={openCreateModal}>
            + New Savings Goal
          </button>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <div className="kpi-grid">
        <div className="kpi-box">
          <div className="kpi-label">Total Saved Toward Goals</div>
          <div className="kpi-value amount-positive">
            {formatMinorUnits(totalSaved, settings.base_currency)}
          </div>
          <div className="kpi-sub">Sum of recorded goal contributions</div>
        </div>
        <div className="kpi-box">
          <div className="kpi-label">Total Goal Targets</div>
          <div className="kpi-value">{formatMinorUnits(totalTarget, settings.base_currency)}</div>
          <div className="kpi-sub">
            Remaining: {formatMinorUnits(Math.max(0, totalTarget - totalSaved), settings.base_currency)}
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Savings Goals ({goals.length})</h3>
        </div>
        {loading && goals.length === 0 ? (
          <div className="panel-body">Loading savings goals...</div>
        ) : goals.length === 0 ? (
          <EmptyState
            title="No savings goals created yet"
            description="Define a savings target for an emergency fund, holiday, vehicle, or major purchase."
            actionLabel="+ New Savings Goal"
            onAction={openCreateModal}
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Goal Name</th>
                  <th>Status</th>
                  <th>Target Date</th>
                  <th className="num">Current Progress</th>
                  <th className="num">Target Amount</th>
                  <th className="num">Remaining</th>
                  <th style={{ minWidth: '160px' }}>Progress</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {goals.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <strong>{g.name}</strong>
                      {g.description && (
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>{g.description}</div>
                      )}
                      {g.account_name && (
                        <div style={{ fontSize: '11.5px', color: '#4b5563' }}>
                          Held in: {g.account_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          g.status === 'completed'
                            ? 'badge-success'
                            : g.status === 'active'
                              ? 'badge-info'
                              : 'badge-neutral'
                        }`}
                      >
                        {g.status.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      {g.target_date
                        ? formatDisplayDate(g.target_date, settings.date_format)
                        : '—'}
                    </td>
                    <td className="num amount-positive">
                      {formatMinorUnits(g.current_amount_minor, settings.base_currency)}
                    </td>
                    <td className="num">
                      {formatMinorUnits(g.target_amount_minor, settings.base_currency)}
                    </td>
                    <td className="num">
                      {formatMinorUnits(g.remaining_amount_minor, settings.base_currency)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="progress-track" style={{ flex: 1 }}>
                          <div
                            className="progress-fill completed"
                            style={{ width: `${Math.min(100, g.percentage_achieved)}%` }}
                          />
                        </div>
                        <span className="num" style={{ fontSize: '12px', minWidth: '45px' }}>
                          {g.percentage_achieved}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => void openContributionsDrawer(g.id)}
                        >
                          Contributions ({g.contributions_count})
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditModal(g)}
                        >
                          Edit
                        </button>
                        {g.status === 'active' && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void handleStatusChange(g, 'completed')}
                          >
                            Complete
                          </button>
                        )}
                        {g.status !== 'archived' ? (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void handleStatusChange(g, 'archived')}
                          >
                            Archive
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-sm"
                            onClick={() => void handleStatusChange(g, 'active')}
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setConfirmDeleteGoal(g)}
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
        )}
      </section>

      <Modal
        isOpen={isGoalModalOpen}
        title={editingGoal ? 'Edit Savings Goal' : 'Create Savings Goal'}
        onClose={() => setIsGoalModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setIsGoalModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="goal-form" className="btn btn-primary">
              {editingGoal ? 'Save Changes' : 'Create Goal'}
            </button>
          </>
        }
      >
        <form id="goal-form" onSubmit={handleSaveGoal}>
          <div className="form-group">
            <label htmlFor="goal-name">Goal Name</label>
            <input
              id="goal-name"
              type="text"
              className="form-control"
              placeholder="e.g., Emergency Fund, Summer Holiday, New Laptop"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="goal-target">Target Amount ({settings.base_currency})</label>
              <input
                id="goal-target"
                type="text"
                inputMode="decimal"
                className="form-control"
                placeholder="5000.00"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
                required
              />
            </div>

            {!editingGoal && (
              <div className="form-group">
                <label htmlFor="goal-initial">Initial Saved Amount (optional)</label>
                <input
                  id="goal-initial"
                  type="text"
                  inputMode="decimal"
                  className="form-control"
                  value={initialContribInput}
                  onChange={(e) => setInitialContribInput(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="goal-date">Target Date (optional)</label>
              <input
                id="goal-date"
                type="date"
                className="form-control"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="goal-account">Reference Account (optional)</label>
              <select
                id="goal-account"
                className="form-control"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">None (Standalone tracking)</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="goal-desc">Description (optional)</label>
            <input
              id="goal-desc"
              type="text"
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(selectedGoalDetail)}
        title={
          selectedGoalDetail ? `Contributions — ${selectedGoalDetail.name}` : 'Contributions'
        }
        size="lg"
        onClose={() => setSelectedGoalDetail(null)}
      >
        {selectedGoalDetail && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '10px 14px',
                backgroundColor: '#f9fafb',
                border: '1px solid #e5e7eb',
                borderRadius: '4px',
                marginBottom: '16px',
              }}
            >
              <span>
                Progress:{' '}
                <strong>
                  {formatMinorUnits(selectedGoalDetail.current_amount_minor, settings.base_currency)}
                </strong>{' '}
                of{' '}
                {formatMinorUnits(selectedGoalDetail.target_amount_minor, settings.base_currency)} (
                {selectedGoalDetail.percentage_achieved}%)
              </span>
              <span>
                Remaining:{' '}
                <strong>
                  {formatMinorUnits(selectedGoalDetail.remaining_amount_minor, settings.base_currency)}
                </strong>
              </span>
            </div>

            <form
              onSubmit={handleAddContribution}
              style={{
                display: 'flex',
                gap: '8px',
                alignItems: 'flex-end',
                flexWrap: 'wrap',
                marginBottom: '16px',
                paddingBottom: '14px',
                borderBottom: '1px solid #e5e7eb',
              }}
            >
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="contrib-amount">Amount (+ add / - withdraw)</label>
                <input
                  id="contrib-amount"
                  type="text"
                  inputMode="decimal"
                  className="form-control"
                  placeholder="250.00"
                  value={contribAmountInput}
                  onChange={(e) => setContribAmountInput(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="contrib-date">Date</label>
                <input
                  id="contrib-date"
                  type="date"
                  className="form-control"
                  value={contribDate}
                  onChange={(e) => setContribDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                <label htmlFor="contrib-notes">Notes</label>
                <input
                  id="contrib-notes"
                  type="text"
                  className="form-control"
                  placeholder="Monthly allocation"
                  value={contribNotes}
                  onChange={(e) => setContribNotes(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-primary">
                + Record Contribution
              </button>
            </form>

            {selectedGoalDetail.contributions.length === 0 ? (
              <div className="empty-state">No contributions recorded yet.</div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Notes</th>
                      <th className="num">Amount</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedGoalDetail.contributions.map((c) => (
                      <tr key={c.id}>
                        <td>{formatDisplayDate(c.contribution_date, settings.date_format)}</td>
                        <td>{c.notes || '—'}</td>
                        <td
                          className={`num ${
                            c.amount_minor >= 0 ? 'amount-positive' : 'amount-negative'
                          }`}
                        >
                          {formatMinorUnits(c.amount_minor, settings.base_currency, {
                            showExplicitSign: true,
                          })}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => void handleDeleteContribution(c.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteGoal)}
        title="Delete Savings Goal"
        message={`Are you sure you want to delete "${confirmDeleteGoal?.name}" and its contribution history?`}
        confirmLabel="Delete Goal"
        onConfirm={() => void handleDeleteGoal()}
        onCancel={() => setConfirmDeleteGoal(null)}
      />
    </div>
  );
};
