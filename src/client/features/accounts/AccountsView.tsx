import React, { useState } from 'react';
import { apiClient } from '../../services/apiClient.js';
import type { Account, AppSettings, Category } from '../../../shared/types/index.js';
import { ACCOUNT_TYPES } from '../../../shared/constants/index.js';
import {
  formatMinorUnits,
  minorUnitsToDecimalString,
  parseDecimalToMinorUnits,
} from '../../../shared/utils/money.js';
import { PageHeader } from '../../components/layout/Sidebar.js';
import { AlertBanner, EmptyState } from '../../components/feedback/Feedback.js';
import { ConfirmDialog, Modal } from '../../components/dialogs/Modal.js';
import { TransactionModal } from '../transactions/TransactionModal.js';

interface AccountsViewProps {
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  onDataMutated: () => void;
  onViewAccountTransactions: (accountId: string) => void;
}

export const AccountsView: React.FC<AccountsViewProps> = ({
  settings,
  accounts,
  categories,
  onDataMutated,
  onViewAccountTransactions,
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [name, setName] = useState<string>('');
  const [accountType, setAccountType] = useState<Account['account_type']>('current');
  const [openingBalanceInput, setOpeningBalanceInput] = useState<string>('0.00');
  const [description, setDescription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState<Account | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState<boolean>(false);
  const [transferSourceId, setTransferSourceId] = useState<string | undefined>(undefined);

  const activeAccounts = accounts.filter((a) => a.status === 'active');
  const archivedAccounts = accounts.filter((a) => a.status === 'archived');
  const totalActiveBalance = activeAccounts.reduce((s, a) => s + a.current_balance_minor, 0);

  const openCreateModal = () => {
    setEditingAccount(null);
    setName('');
    setAccountType('current');
    setOpeningBalanceInput('0.00');
    setDescription('');
    setError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (acc: Account) => {
    setEditingAccount(acc);
    setName(acc.name);
    setAccountType(acc.account_type);
    setOpeningBalanceInput(minorUnitsToDecimalString(acc.opening_balance_minor));
    setDescription(acc.description);
    setError(null);
    setIsModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let openingMinor: number;
    try {
      openingMinor = parseDecimalToMinorUnits(openingBalanceInput, {
        allowNegative: true,
        allowZero: true,
      });
    } catch (err) {
      setError((err as Error).message);
      return;
    }

    try {
      if (editingAccount) {
        await apiClient.updateAccount(editingAccount.id, {
          name: name.trim(),
          account_type: accountType,
          opening_balance_minor: openingMinor,
          description: description.trim(),
        });
        setFeedback(`Updated account "${name.trim()}".`);
      } else {
        await apiClient.createAccount({
          name: name.trim(),
          account_type: accountType,
          opening_balance_minor: openingMinor,
          description: description.trim(),
        });
        setFeedback(`Created account "${name.trim()}".`);
      }
      setIsModalOpen(false);
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleToggleArchive = async (acc: Account) => {
    try {
      const nextArchived = acc.status === 'active';
      await apiClient.archiveAccount(acc.id, nextArchived);
      setFeedback(
        nextArchived
          ? `Archived account "${acc.name}". Historical records remain intact.`
          : `Reactivated account "${acc.name}".`
      );
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDeleteAccount = async () => {
    if (!confirmDeleteAccount) return;
    try {
      await apiClient.deleteAccount(confirmDeleteAccount.id);
      setFeedback(`Deleted unused account "${confirmDeleteAccount.name}".`);
      setConfirmDeleteAccount(null);
      onDataMutated();
    } catch (err) {
      setError((err as Error).message);
      setConfirmDeleteAccount(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Manage accounts where your money is held. Balances are reconciled automatically from opening balances and ledger entries."
        actions={
          <>
            {activeAccounts.length >= 2 && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setTransferSourceId(activeAccounts[0]?.id);
                  setIsTransferModalOpen(true);
                }}
              >
                ⇄ Transfer Between Accounts
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={openCreateModal}>
              + New Account
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
          <div className="kpi-label">Combined Active Balance</div>
          <div className="kpi-value">
            {formatMinorUnits(totalActiveBalance, settings.base_currency)}
          </div>
          <div className="kpi-sub">{activeAccounts.length} active account(s)</div>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h3 className="panel-title">Active Accounts</h3>
        </div>
        {activeAccounts.length === 0 ? (
          <EmptyState
            title="No active accounts"
            description="Create a Cash, Current, Savings, or Credit Card account to start tracking your finances."
            actionLabel="+ New Account"
            onAction={openCreateModal}
          />
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>Type</th>
                  <th className="num">Opening Balance</th>
                  <th className="num">Total Inflow (+)</th>
                  <th className="num">Total Outflow (-)</th>
                  <th className="num">Net Movement</th>
                  <th className="num">Current Balance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {activeAccounts.map((acc) => (
                  <tr key={acc.id}>
                    <td>
                      <strong>{acc.name}</strong>
                      {acc.description && (
                        <div style={{ fontSize: '11.5px', color: '#6b7280' }}>{acc.description}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-neutral">
                        {ACCOUNT_TYPES.find((t) => t.value === acc.account_type)?.label ??
                          acc.account_type}
                      </span>
                    </td>
                    <td className="num">
                      {formatMinorUnits(acc.opening_balance_minor, settings.base_currency)}
                    </td>
                    <td className="num amount-positive">
                      +{formatMinorUnits(acc.inflow_minor, settings.base_currency)}
                    </td>
                    <td className="num amount-negative">
                      -{formatMinorUnits(acc.outflow_minor, settings.base_currency)}
                    </td>
                    <td className="num">
                      {formatMinorUnits(acc.net_movement_minor, settings.base_currency, {
                        showExplicitSign: true,
                      })}
                    </td>
                    <td className="num">
                      <strong>
                        {formatMinorUnits(acc.current_balance_minor, settings.base_currency)}
                      </strong>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onViewAccountTransactions(acc.id)}
                        >
                          History ({acc.transaction_count})
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openEditModal(acc)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => void handleToggleArchive(acc)}
                        >
                          Archive
                        </button>
                        {acc.transaction_count === 0 && (
                          <button
                            type="button"
                            className="btn btn-sm btn-danger"
                            onClick={() => setConfirmDeleteAccount(acc)}
                          >
                            Delete
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

      {archivedAccounts.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <h3 className="panel-title">Archived Accounts ({archivedAccounts.length})</h3>
          </div>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Account Name</th>
                  <th>Type</th>
                  <th className="num">Current Balance</th>
                  <th>Transactions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {archivedAccounts.map((acc) => (
                  <tr key={acc.id}>
                    <td>{acc.name}</td>
                    <td>{acc.account_type}</td>
                    <td className="num">
                      {formatMinorUnits(acc.current_balance_minor, settings.base_currency)}
                    </td>
                    <td>{acc.transaction_count} record(s)</td>
                    <td>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => onViewAccountTransactions(acc.id)}
                        >
                          View History
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => void handleToggleArchive(acc)}
                        >
                          Unarchive
                        </button>
                      </div>
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
        title={editingAccount ? 'Edit Account' : 'Create Account'}
        onClose={() => setIsModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setIsModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" form="account-form" className="btn btn-primary">
              {editingAccount ? 'Save Changes' : 'Create Account'}
            </button>
          </>
        }
      >
        <form id="account-form" onSubmit={handleSaveAccount}>
          <div className="form-group">
            <label htmlFor="acc-name">Account Name</label>
            <input
              id="acc-name"
              type="text"
              className="form-control"
              placeholder="e.g., Main Checking, Emergency Savings, Wallet Cash"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="acc-type">Account Type</label>
              <select
                id="acc-type"
                className="form-control"
                value={accountType}
                onChange={(e) => setAccountType(e.target.value as Account['account_type'])}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="acc-opening">Opening Balance ({settings.base_currency})</label>
              <input
                id="acc-opening"
                type="text"
                inputMode="decimal"
                className="form-control"
                value={openingBalanceInput}
                onChange={(e) => setOpeningBalanceInput(e.target.value)}
                required
              />
              <span className="form-hint">Can be positive, zero, or negative (e.g. credit balance)</span>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="acc-desc">Description (optional)</label>
            <input
              id="acc-desc"
              type="text"
              className="form-control"
              placeholder="Notes about this account"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </form>
      </Modal>

      <TransactionModal
        isOpen={isTransferModalOpen}
        onClose={() => setIsTransferModalOpen(false)}
        onSaved={onDataMutated}
        accounts={accounts}
        categories={categories}
        defaultType="transfer"
        defaultAccountId={transferSourceId}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmDeleteAccount)}
        title="Delete Account"
        message={`Are you sure you want to delete "${confirmDeleteAccount?.name}"?`}
        confirmLabel="Delete Account"
        onConfirm={() => void handleDeleteAccount()}
        onCancel={() => setConfirmDeleteAccount(null)}
      />
    </div>
  );
};
