import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type { AppSettings, BudgetWithActuals, Category } from '../../../shared/types/index.js';
import {
  formatMinorUnits,
  minorUnitsToDecimalString,
  parseDecimalToMinorUnits,
} from '../../../shared/utils/money.js';
import { getCurrentIsoMonth } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import { AlertBanner, EmptyState } from '../../components/feedback/Feedback.js';
import { ConfirmDialog, Modal } from '../../components/dialogs/Modal.js';

interface BudgetsViewProps {
  settings: AppSettings;
  categories: Category[];
  refreshTrigger: number;
  onDataMutated: () => void;
  onInspectCategoryTransactions: (categoryId: string) => void;
}

export const BudgetsView: React.FC<BudgetsViewProps> = ({
  settings,
  categories,
  refreshTrigger,
  onDataMutated,
  onInspectCategoryTransactions,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentIsoMonth());
  const [budgets, setBudgets] = useState<BudgetWithActuals[]>([]);
  const [allHistoricalBudgets, setAllHistoricalBudgets] = useState<BudgetWithActuals[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingBudget, setEditingBudget] = useState<BudgetWithActuals | null>(null);
  const [name, setName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [periodMonth, setPeriodMonth] = useState<string>(getCurrentIsoMonth());
  const [plannedInput, setPlannedInput] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [confirmDeleteBudget, setConfirmDeleteBudget] = useState<BudgetWithActuals | null>(null);

  const expenseCategories = categories.filter((c) => c.category_type === 'expense' && !c.is_archived);

  const loadBudgets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [monthItems, allItems] = await Promise.all([
        apiClient.getBudgets({ periodMonth: selectedMonth }),
        apiClient.getBudgets({ includeArchived: true }),
      ]);
      setBudgets(monthItems);
      setAllHistoricalBudgets(allItems);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth]);

  useEffect(() => {
    void loadBudgets();
  }, [loadBudgets, refreshTrigger]);

  const openCreateModal = () => {
    setEditingBudget(null);
    setName('');
    setCategoryId(expenseCategories[0]?.id ?? '');
    setPeriodMonth(selectedMonth);
    setPlannedInput('');
    setNotes('');
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (b: BudgetWithActuals) => {
    setEditingBudget(b);
    setName(b.name);
    setCategoryId(b.category_id ?? '');
    setPeriodMonth(b.period_month);
    setPlannedInput(minorUnitsToDecimalString(b.planned_amount_minor));
    setNotes(b.notes);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let plannedMinor: number;
    try {
      plannedMinor = parseDecimalToMinorUnits(plannedInput, {
        allowNegative: false,
        allowZero: false,
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    try {
      if (editingBudget) {
        await apiClient.updateBudget(editingBudget.id, {
          name: name.trim(),
          planned_amount_minor: plannedMinor,
          notes: notes.trim(),
        });
        setFeedback(`Updated budget "${name.trim()}".`);
      } else {
        await apiClient.createBudget({
          name: name.trim(),
          category_id: categoryId === '__OVERALL__' || !categoryId ? null : categoryId,
          period_month: periodMonth,
          planned_amount_minor: plannedMinor,
          notes: notes.trim(),
        });
        setFeedback(`Created budget "${name.trim()}" for ${periodMonth}.`);
      }
      setIsModalOpen(false);
      onDataMutated();
      void loadBudgets();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteBudget) return;
    try {
      await apiClient.deleteBudget(confirmDeleteBudget.id);
      setFeedback(`Deleted budget "${confirmDeleteBudget.name}".`);
      setConfirmDeleteBudget(null);
      onDataMutated();
      void loadBudgets();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDeleteBudget(null);
    }
  };

  const totalPlanned = budgets.reduce((s, b) => s + b.planned_amount_minor, 0);
  const totalActual = budgets.reduce((s, b) => s + b.actual_minor, 0);
  const totalRemaining = totalPlanned - totalActual;

  return (
    <div>
      <PageHeader
        title="Monthly Budgets"
        description="Define monthly spending limits by category or overall total. Transfers and deleted records are excluded automatically."
        actions={
          <>
            <label htmlFor="budget-month-picker" style={{ fontSize: '12.5px', fontWeight: 600 }}>
              Month:
            </label>
            <input
              id="budget-month-picker"
              type="month"
              className="form-control"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
            <button type="button" className="btn btn-primary" onClick={openCreateModal}>
              + New Budget
            </button>
          </>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      <div className="kpi-grid">
        <div className="kpi-box">
          <div className="kpi-label">Total Planned ({selectedMonth})</div>
          <div className="kpi-value">
            {formatMinorUnits(totalPlanned, settings.base_currency)}
          </div>
          <div className="kpi-sub">{budgets.length} active budget(s) in {selectedMonth}</div>
        </div>

        <div className="kpi-box">
          <div className="kpi-label">Actual Eligible Spending</div>
          <div className="kpi-value amount-negative">
            {formatMinorUnits(totalActual, settings.base_currency)}
          </div>
          <div className="kpi-sub">Net of linked expense refunds</div>
        </div>

        <div className="kpi-box">
          <div className="kpi-label">Net Remaining Capacity</div>
          <div className={`kpi-value ${totalRemaining < 0 ? 'amount-negative' : 'amount-positive'}`}>
            {formatMinorUnits(totalRemaining, settings.base_currency)}
          </div>
          <div className="kpi-sub">
            {totalRemaining < 0 ? 'Over planned total' : 'Available within planned budgets'}
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Budgets for {selectedMonth}</h3>
        </div>
        {loading && budgets.length === 0 ? (
          <div className="panel-body">Loading budgets...</div>
        ) : budgets.length === 0 ? (
          <EmptyState
            title={`No budgets defined for ${selectedMonth}`}
            description="Create category budgets or an overall monthly spending limit for this month."
            actionLabel="+ New Budget"
            onAction={openCreateModal}
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Budget Name</th>
                  <th>Category</th>
                  <th className="num">Planned Limit</th>
                  <th className="num">Actual Spending</th>
                  <th className="num">Remaining</th>
                  <th style={{ minWidth: '170px' }}>Usage</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {budgets.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.name}</strong>
                      {b.notes && (
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>{b.notes}</div>
                      )}
                    </td>
                    <td>
                      {b.category_id ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onInspectCategoryTransactions(b.category_id!)}
                        >
                          {b.category_name} →
                        </button>
                      ) : (
                        <span className="badge badge-neutral">All Expense Categories</span>
                      )}
                    </td>
                    <td className="num">
                      {formatMinorUnits(b.planned_amount_minor, settings.base_currency)}
                    </td>
                    <td className="num">
                      {formatMinorUnits(b.actual_minor, settings.base_currency)}
                    </td>
                    <td
                      className={`num ${
                        b.remaining_minor < 0 ? 'amount-negative' : 'amount-positive'
                      }`}
                    >
                      {formatMinorUnits(b.remaining_minor, settings.base_currency)}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="progress-track" style={{ flex: 1 }}>
                          <div
                            className={`progress-fill ${b.is_overspent ? 'overspent' : ''}`}
                            style={{ width: `${Math.min(100, b.percentage_used)}%` }}
                          />
                        </div>
                        <span className="num" style={{ fontSize: '12px', minWidth: '45px' }}>
                          {b.percentage_used}%
                        </span>
                      </div>
                    </td>
                    <td>
                      {b.is_overspent ? (
                        <span className="badge badge-danger">[!] Overspent</span>
                      ) : b.percentage_used >= 85 ? (
                        <span className="badge badge-warning">[Near Limit]</span>
                      ) : (
                        <span className="badge badge-success">[OK] Within Budget</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditModal(b)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          onClick={() => setConfirmDeleteBudget(b)}
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

      {allHistoricalBudgets.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Historical Budget Performance (All Months)</h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Budget Name</th>
                  <th>Category</th>
                  <th className="num">Planned</th>
                  <th className="num">Actual</th>
                  <th className="num">Variance</th>
                  <th className="num">% Used</th>
                </tr>
              </thead>
              <tbody>
                {allHistoricalBudgets.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.period_month}</strong>
                    </td>
                    <td>{b.name}</td>
                    <td>{b.category_name}</td>
                    <td className="num">
                      {formatMinorUnits(b.planned_amount_minor, settings.base_currency)}
                    </td>
                    <td className="num">
                      {formatMinorUnits(b.actual_minor, settings.base_currency)}
                    </td>
                    <td
                      className={`num ${
                        b.remaining_minor < 0 ? 'amount-negative' : 'amount-positive'
                      }`}
                    >
                      {formatMinorUnits(b.remaining_minor, settings.base_currency)}
                    </td>
                    <td className="num">{b.percentage_used}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Modal
        isOpen={isModalOpen}
        title={editingBudget ? 'Edit Budget' : 'Create Monthly Budget'}
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="budget-form" className="btn btn-primary">
              {editingBudget ? 'Save Changes' : 'Create Budget'}
            </button>
          </>
        }
      >
        <form id="budget-form" onSubmit={handleSave}>
          <div className="form-group">
            <label htmlFor="bdg-name">Budget Name</label>
            <input
              id="bdg-name"
              type="text"
              className="form-control"
              placeholder="e.g., Monthly Groceries, Dining Out Limit, Overall Spending"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          {!editingBudget && (
            <div className="form-grid">
              <div className="form-group">
                <label htmlFor="bdg-category">Expense Category</label>
                <select
                  id="bdg-category"
                  className="form-control"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="__OVERALL__">Overall Monthly Budget (All Categories)</option>
                  {expenseCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="bdg-month">Calendar Month</label>
                <input
                  id="bdg-month"
                  type="month"
                  className="form-control"
                  value={periodMonth}
                  onChange={(e) => setPeriodMonth(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="bdg-amount">Planned Monthly Limit ({settings.base_currency})</label>
            <input
              id="bdg-amount"
              type="text"
              inputMode="decimal"
              className="form-control"
              placeholder="500.00"
              value={plannedInput}
              onChange={(e) => setPlannedInput(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="bdg-notes">Notes (optional)</label>
            <input
              id="bdg-notes"
              type="text"
              className="form-control"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteBudget)}
        title="Delete Budget"
        message={`Are you sure you want to delete budget "${confirmDeleteBudget?.name}"? Underlying transactions will not be affected.`}
        confirmLabel="Delete Budget"
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDeleteBudget(null)}
      />
    </div>
  );
};
