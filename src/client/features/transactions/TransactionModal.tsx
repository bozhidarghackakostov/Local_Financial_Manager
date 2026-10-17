import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/dialogs/Modal.js';
import { AlertBanner } from '../../components/feedback/Feedback.js';
import { apiClient } from '../../services/apiClient.js';
import type {
  Account,
  Category,
  TransactionRecord,
  TransactionType,
} from '../../../shared/types/index.js';
import {
  minorUnitsToDecimalString,
  parseDecimalToMinorUnits,
} from '../../../shared/utils/money.js';
import { getTodayIsoDate } from '../../../shared/utils/dates.js';

interface TransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  accounts: Account[];
  categories: Category[];
  editingTransaction?: TransactionRecord | null;
  defaultType?: TransactionType;
  defaultAccountId?: string;
}

export const TransactionModal: React.FC<TransactionModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  accounts,
  categories,
  editingTransaction,
  defaultType = 'expense',
  defaultAccountId,
}) => {
  const activeAccounts = accounts.filter((a) => a.status === 'active' || a.id === editingTransaction?.account_id);

  const [txType, setTxType] = useState<TransactionType>(defaultType);
  const [txDate, setTxDate] = useState<string>(getTodayIsoDate());
  const [amountInput, setAmountInput] = useState<string>('');
  const [accountId, setAccountId] = useState<string>('');
  const [destinationAccountId, setDestinationAccountId] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [tagsInput, setTagsInput] = useState<string>('');
  const [isRefund, setIsRefund] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const eligibleCategories = categories.filter(
    (c) =>
      c.category_type === (txType === 'income' ? 'income' : 'expense') &&
      (!c.is_archived || c.id === editingTransaction?.category_id)
  );

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (editingTransaction) {
      setTxType(editingTransaction.transaction_type);
      setTxDate(editingTransaction.transaction_date);
      setAmountInput(minorUnitsToDecimalString(editingTransaction.amount_minor));
      setAccountId(editingTransaction.account_id);
      setDestinationAccountId(editingTransaction.destination_account_id ?? '');
      setCategoryId(editingTransaction.category_id ?? '');
      setDescription(editingTransaction.description);
      setNotes(editingTransaction.notes);
      setTagsInput(editingTransaction.tags.join(', '));
      setIsRefund(editingTransaction.is_refund);
    } else {
      const initialType = defaultType;
      setTxType(initialType);
      setTxDate(getTodayIsoDate());
      setAmountInput('');
      const firstAcc = defaultAccountId || activeAccounts[0]?.id || '';
      const secondAcc = activeAccounts.find((a) => a.id !== firstAcc)?.id || '';
      setAccountId(firstAcc);
      setDestinationAccountId(secondAcc);
      const firstCat =
        categories.find(
          (c) => c.category_type === (initialType === 'income' ? 'income' : 'expense') && !c.is_archived
        )?.id || '';
      setCategoryId(firstCat);
      setDescription('');
      setNotes('');
      setTagsInput('');
      setIsRefund(false);
    }
  }, [isOpen, editingTransaction, defaultType, defaultAccountId, accounts, categories]);

  const handleTypeChange = (newType: TransactionType) => {
    setTxType(newType);
    if (newType !== 'expense') {
      setIsRefund(false);
    }
    if (newType !== 'transfer') {
      const matchingCat = categories.find(
        (c) => c.category_type === newType && !c.is_archived
      );
      setCategoryId(matchingCat?.id ?? '');
    } else {
      const otherAcc = activeAccounts.find((a) => a.id !== accountId)?.id || '';
      setDestinationAccountId(otherAcc);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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

    if (!accountId) {
      setError('Please select an account.');
      return;
    }

    if (txType === 'transfer') {
      if (!destinationAccountId) {
        setError('Please select a destination account for the transfer.');
        return;
      }
      if (destinationAccountId === accountId) {
        setError('Source and destination accounts must be different.');
        return;
      }
    } else if (!categoryId) {
      setError('Please select a category.');
      return;
    }

    const tags = tagsInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      const payload = {
        transaction_type: txType,
        transaction_date: txDate,
        amount_minor: amountMinor,
        account_id: accountId,
        destination_account_id: txType === 'transfer' ? destinationAccountId : null,
        category_id: txType === 'transfer' ? null : categoryId,
        description: description.trim(),
        notes: notes.trim(),
        tags,
        is_refund: txType === 'expense' ? isRefund : false,
      };

      if (editingTransaction) {
        await apiClient.updateTransaction(editingTransaction.id, payload);
      } else {
        await apiClient.createTransaction(payload);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title={editingTransaction ? 'Edit Transaction' : 'Record Transaction'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="transaction-form"
            className="btn btn-primary"
            disabled={submitting}
          >
            {submitting
              ? 'Saving...'
              : editingTransaction
                ? 'Save Changes'
                : 'Record Transaction'}
          </button>
        </>
      }
    >
      {error && <AlertBanner type="error" message={error} onDismiss={() => setError(null)} />}

      {activeAccounts.length === 0 && (
        <AlertBanner
          type="info"
          message="You need at least one active account before recording a transaction. Go to Accounts to create one."
        />
      )}

      <form id="transaction-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="tx-type">Transaction Type</label>
            <select
              id="tx-type"
              className="form-control"
              value={txType}
              onChange={(e) => handleTypeChange(e.target.value as TransactionType)}
            >
              <option value="expense">Expense (-)</option>
              <option value="income">Income (+)</option>
              <option value="transfer">Transfer Between Accounts (⇄)</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="tx-date">Transaction Date</label>
            <input
              id="tx-date"
              type="date"
              className="form-control"
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="tx-amount">Amount</label>
            <input
              id="tx-amount"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              className="form-control"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              required
            />
            <span className="form-hint">Positive amount with up to 2 decimal places</span>
          </div>

          <div className="form-group">
            <label htmlFor="tx-account">
              {txType === 'transfer' ? 'Source Account (From)' : 'Account'}
            </label>
            <select
              id="tx-account"
              className="form-control"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              required
            >
              <option value="">Select account...</option>
              {activeAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.account_type})
                </option>
              ))}
            </select>
          </div>
        </div>

        {txType === 'transfer' ? (
          <div className="form-group">
            <label htmlFor="tx-dest-account">Destination Account (To)</label>
            <select
              id="tx-dest-account"
              className="form-control"
              value={destinationAccountId}
              onChange={(e) => setDestinationAccountId(e.target.value)}
              required
            >
              <option value="">Select destination account...</option>
              {activeAccounts
                .filter((acc) => acc.id !== accountId)
                .map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.account_type})
                  </option>
                ))}
            </select>
            <span className="form-hint">
              Transfers move money between accounts without counting as income or expense.
            </span>
          </div>
        ) : (
          <div className="form-group">
            <label htmlFor="tx-category">Category</label>
            <select
              id="tx-category"
              className="form-control"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              <option value="">Select category...</option>
              {eligibleCategories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.parent_name ? `${cat.parent_name} → ${cat.name}` : cat.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {txType === 'expense' && (
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '8px' }}>
            <input
              id="tx-is-refund"
              type="checkbox"
              checked={isRefund}
              onChange={(e) => setIsRefund(e.target.checked)}
            />
            <label htmlFor="tx-is-refund" style={{ marginBottom: 0 }}>
              Record as Expense Refund (credits the account and reduces spending in this category)
            </label>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="tx-description">Description / Merchant</label>
          <input
            id="tx-description"
            type="text"
            className="form-control"
            placeholder="e.g., Supermarket, Monthly Rent, Client Invoice"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="tx-tags">Tags (comma-separated, optional)</label>
            <input
              id="tx-tags"
              type="text"
              className="form-control"
              placeholder="e.g., groceries, household"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="tx-notes">Notes (optional)</label>
            <input
              id="tx-notes"
              type="text"
              className="form-control"
              placeholder="Additional details"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
};
