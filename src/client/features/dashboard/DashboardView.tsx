import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type {
  AppSettings,
  DashboardSummary,
  PeriodPreset,
} from '../../../shared/types/index.js';
import { PERIOD_PRESETS } from '../../../shared/constants/index.js';
import { formatMinorUnits } from '../../../shared/utils/money.js';
import { formatDisplayDate, getTodayIsoDate } from '../../../shared/utils/dates.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import {
  AlertBanner,
  EmptyState,
  SignedAmountCell,
  TransactionTypeBadge,
} from '../../components/feedback/Feedback.js';
import {
  CategoryBreakdownBars,
  IncomeExpenseBarChart,
} from '../../components/charts/Charts.js';
import type { NavPageId } from '../../app/navigation.js';

interface DashboardViewProps {
  settings: AppSettings;
  refreshTrigger: number;
  onNavigate: (
    page: NavPageId,
    filters?: { categoryId?: string; accountId?: string }
  ) => void;
  onNewTransaction: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  settings,
  refreshTrigger,
  onNavigate,
  onNewTransaction,
}) => {
  const [preset, setPreset] = useState<PeriodPreset>(settings.default_period || 'this_month');
  const [customStart, setCustomStart] = useState<string>(getTodayIsoDate().slice(0, 8) + '01');
  const [customEnd, setCustomEnd] = useState<string>(getTodayIsoDate());
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.getDashboardSummary({
        preset,
        startDate: preset === 'custom' ? customStart : undefined,
        endDate: preset === 'custom' ? customEnd : undefined,
      });
      setSummary(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [preset, customStart, customEnd]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, refreshTrigger]);

  const handleQuickConfirmOccurrence = async (occurrenceId: string, ruleName: string) => {
    try {
      await apiClient.confirmOccurrence(occurrenceId);
      setFeedback(`Confirmed and posted recurring payment: "${ruleName}"`);
      void loadDashboard();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const currency = summary?.currency ?? settings.base_currency;

  return (
    <div>
      <PageHeader
        title="Financial Dashboard"
        description="Real-time overview derived directly from your local ledger."
        actions={
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <label htmlFor="dashboard-period-select" style={{ fontSize: '12.5px', fontWeight: 600 }}>
              Period:
            </label>
            <select
              id="dashboard-period-select"
              className="form-control"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PeriodPreset)}
            >
              {PERIOD_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {preset === 'custom' && (
              <>
                <input
                  type="date"
                  aria-label="Custom Start Date"
                  className="form-control"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Custom End Date"
                  className="form-control"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </>
            )}
          </div>
        }
      />

      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}
      {feedback && (
        <AlertBanner type="success" message={feedback} onDismiss={() => setFeedback(null)} />
      )}

      {loading && !summary ? (
        <div className="panel">
          <div className="panel-body">Loading financial summary...</div>
        </div>
      ) : summary ? (
        <>
          <div className="kpi-grid">
            <div
              className="kpi-box clickable-row"
              onClick={() => onNavigate('accounts')}
              title="View all accounts"
            >
              <div className="kpi-label">Total Available Balance</div>
              <div className="kpi-value">
                {formatMinorUnits(summary.total_balance_minor, currency)}
              </div>
              <div className="kpi-sub">
                Across {summary.active_accounts_count} active account(s)
              </div>
            </div>

            <div className="kpi-box">
              <div className="kpi-label">Period Income</div>
              <div className="kpi-value amount-positive">
                +{formatMinorUnits(summary.period_income_minor, currency)}
              </div>
              <div className="kpi-sub">
                {formatDisplayDate(summary.period.startDate, settings.date_format)} —{' '}
                {formatDisplayDate(summary.period.endDate, settings.date_format)}
              </div>
            </div>

            <div className="kpi-box">
              <div className="kpi-label">Period Expenses</div>
              <div className="kpi-value amount-negative">
                -{formatMinorUnits(summary.period_expense_minor, currency)}
              </div>
              <div className="kpi-sub">Excludes inter-account transfers</div>
            </div>

            <div className="kpi-box">
              <div className="kpi-label">Net Cash Flow</div>
              <div
                className={`kpi-value ${
                  summary.net_cash_flow_minor > 0
                    ? 'amount-positive'
                    : summary.net_cash_flow_minor < 0
                      ? 'amount-negative'
                      : ''
                }`}
              >
                {formatMinorUnits(summary.net_cash_flow_minor, currency, {
                  showExplicitSign: true,
                })}
              </div>
              <div className="kpi-sub">Income minus net expenses</div>
            </div>
          </div>

          {summary.active_accounts_count === 0 && (
            <div className="panel">
              <EmptyState
                title="Welcome to LedgerDesk — Start by creating your first account"
                description="Add a checking, savings, cash, or credit card account to begin recording transactions."
                actionLabel="Manage Accounts"
                onAction={() => onNavigate('accounts')}
              />
            </div>
          )}

          <div className="grid-2">
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Income vs. Expenses Trend</h3>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('reports')}
                >
                  Full Reports
                </button>
              </div>
              <div className="panel-body">
                <IncomeExpenseBarChart
                  series={summary.cash_flow_series}
                  currency={currency}
                />
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Spending by Category</h3>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  Click a category to inspect transactions
                </span>
              </div>
              <div className="panel-body">
                <CategoryBreakdownBars
                  items={summary.spending_by_category}
                  currency={currency}
                  onSelectCategory={(catId) =>
                    onNavigate('transactions', { categoryId: catId })
                  }
                />
              </div>
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">
                  Monthly Budget Usage ({summary.budgets_summary.month})
                </h3>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('budgets')}
                >
                  Manage Budgets
                </button>
              </div>
              <div className="panel-body">
                {summary.budgets_summary.items.length === 0 ? (
                  <EmptyState
                    title="No budgets configured for this month"
                    description="Set monthly category spending limits to monitor your budget capacity."
                    actionLabel="Create Budget"
                    onAction={() => onNavigate('budgets')}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {summary.budgets_summary.items.map((b) => (
                      <div
                        key={b.id}
                        className="clickable-row"
                        onClick={() => onNavigate('budgets')}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '4px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '4px',
                            fontSize: '13px',
                          }}
                        >
                          <span>
                            <strong>{b.name}</strong> ({b.category_name})
                          </span>
                          <span className="num">
                            {formatMinorUnits(b.actual_minor, currency)} /{' '}
                            {formatMinorUnits(b.planned_amount_minor, currency)} (
                            {b.percentage_used}%)
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className={`progress-fill ${b.is_overspent ? 'overspent' : ''}`}
                            style={{ width: `${Math.min(100, b.percentage_used)}%` }}
                          />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: '4px',
                            fontSize: '12px',
                          }}
                        >
                          <span>
                            {b.is_overspent ? (
                              <span className="badge badge-danger">
                                [!] Overspent by{' '}
                                {formatMinorUnits(Math.abs(b.remaining_minor), currency)}
                              </span>
                            ) : (
                              <span style={{ color: '#4b5563' }}>
                                Remaining: {formatMinorUnits(b.remaining_minor, currency)}
                              </span>
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Upcoming Recurring Payments</h3>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('recurring')}
                >
                  All Schedules
                </button>
              </div>
              <div className="panel-body">
                {summary.upcoming_occurrences.length === 0 ? (
                  <EmptyState
                    title="No upcoming payments due soon"
                    description="Track recurring bills, subscriptions, or salary schedules."
                    actionLabel="Manage Recurring"
                    onAction={() => onNavigate('recurring')}
                  />
                ) : (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Due Date</th>
                          <th>Payment</th>
                          <th>Urgency</th>
                          <th className="num">Amount</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.upcoming_occurrences.map((occ) => (
                          <tr key={occ.id}>
                            <td>{formatDisplayDate(occ.due_date, settings.date_format)}</td>
                            <td>
                              <strong>{occ.rule_name}</strong>
                              <div style={{ fontSize: '11.5px', color: '#6b7280' }}>
                                {occ.account_name} · {occ.category_name}
                              </div>
                            </td>
                            <td>
                              {occ.urgency === 'overdue' && (
                                <span className="badge badge-danger">[!] Overdue</span>
                              )}
                              {occ.urgency === 'due_soon' && (
                                <span className="badge badge-warning">[Due Soon]</span>
                              )}
                              {occ.urgency === 'upcoming' && (
                                <span className="badge badge-neutral">Scheduled</span>
                              )}
                            </td>
                            <td className="num">
                              <SignedAmountCell
                                type={occ.transaction_type}
                                amountMinor={occ.expected_amount_minor}
                                currency={currency}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() =>
                                  void handleQuickConfirmOccurrence(occ.id, occ.rule_name)
                                }
                              >
                                Confirm & Post
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Savings Goals Progress</h3>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('goals')}
                >
                  Manage Goals
                </button>
              </div>
              <div className="panel-body">
                {summary.goals_summary.length === 0 ? (
                  <EmptyState
                    title="No active savings goals"
                    description="Create a goal for an emergency fund, holiday, or major purchase."
                    actionLabel="Create Savings Goal"
                    onAction={() => onNavigate('goals')}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {summary.goals_summary.map((goal) => (
                      <div
                        key={goal.id}
                        className="clickable-row"
                        onClick={() => onNavigate('goals')}
                        style={{
                          padding: '8px 10px',
                          border: '1px solid #e5e7eb',
                          borderRadius: '4px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginBottom: '4px',
                            fontSize: '13px',
                          }}
                        >
                          <strong>{goal.name}</strong>
                          <span className="num">
                            {formatMinorUnits(goal.current_amount_minor, currency)} /{' '}
                            {formatMinorUnits(goal.target_amount_minor, currency)} (
                            {goal.percentage_achieved}%)
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill completed"
                            style={{ width: `${Math.min(100, goal.percentage_achieved)}%` }}
                          />
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            marginTop: '4px',
                            fontSize: '11.5px',
                            color: '#6b7280',
                          }}
                        >
                          <span>
                            Remaining: {formatMinorUnits(goal.remaining_amount_minor, currency)}
                          </span>
                          {goal.target_date && (
                            <span>
                              Target: {formatDisplayDate(goal.target_date, settings.date_format)}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3 className="panel-title">Recent Transactions</h3>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => onNavigate('transactions')}
                >
                  View All Ledger Entries
                </button>
              </div>
              <div className="panel-body" style={{ padding: 0 }}>
                {summary.recent_transactions.length === 0 ? (
                  <EmptyState
                    title="No transactions recorded yet"
                    description="Record your first income, expense, or transfer to populate the ledger."
                    actionLabel="+ Record Transaction"
                    onAction={onNewTransaction}
                  />
                ) : (
                  <div className="table-wrapper">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Type</th>
                          <th>Description</th>
                          <th>Account / Category</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recent_transactions.map((tx) => (
                          <tr
                            key={tx.id}
                            className="clickable-row"
                            onClick={() => onNavigate('transactions')}
                          >
                            <td>{formatDisplayDate(tx.transaction_date, settings.date_format)}</td>
                            <td>
                              <TransactionTypeBadge
                                type={tx.transaction_type}
                                isRefund={tx.is_refund}
                              />
                            </td>
                            <td>{tx.description || '—'}</td>
                            <td>
                              {tx.transaction_type === 'transfer'
                                ? `${tx.account_name} → ${tx.destination_account_name}`
                                : `${tx.account_name} · ${tx.category_name}`}
                            </td>
                            <td className="num">
                              <SignedAmountCell
                                type={tx.transaction_type}
                                amountMinor={tx.amount_minor}
                                currency={tx.currency}
                                isRefund={tx.is_refund}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
};
