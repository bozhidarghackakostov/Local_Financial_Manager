import React from 'react';
import type { TransactionType } from '../../../shared/types/index.js';
import { formatMinorUnits } from '../../../shared/utils/money.js';

export const TransactionTypeBadge: React.FC<{
  type: TransactionType;
  isRefund?: boolean;
}> = ({ type, isRefund }) => {
  if (type === 'income') {
    return <span className="badge badge-income">[+] Income</span>;
  }
  if (type === 'expense') {
    if (isRefund) {
      return <span className="badge badge-income">[+↩] Refund</span>;
    }
    return <span className="badge badge-expense">[-] Expense</span>;
  }
  return <span className="badge badge-transfer">[⇄] Transfer</span>;
};

export const SignedAmountCell: React.FC<{
  type: TransactionType;
  amountMinor: number;
  currency: string;
  isRefund?: boolean;
}> = ({ type, amountMinor, currency, isRefund }) => {
  if (type === 'income' || (type === 'expense' && isRefund)) {
    return (
      <span className="num amount-positive">
        +{formatMinorUnits(amountMinor, currency)}
      </span>
    );
  }
  if (type === 'expense') {
    return (
      <span className="num amount-negative">
        -{formatMinorUnits(amountMinor, currency)}
      </span>
    );
  }
  return (
    <span className="num amount-neutral">
      ⇄ {formatMinorUnits(amountMinor, currency)}
    </span>
  );
};

export const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}> = ({ title, description, actionLabel, onAction }) => {
  return (
    <div className="empty-state">
      <h4 className="empty-state-title">{title}</h4>
      <p className="empty-state-desc">{description}</p>
      {actionLabel && onAction && (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
};

export const AlertBanner: React.FC<{
  type: 'error' | 'success' | 'info';
  message: string;
  onDismiss?: () => void;
}> = ({ type, message, onDismiss }) => {
  return (
    <div className={`alert alert-${type}`} role={type === 'error' ? 'alert' : 'status'}>
      <span>{message}</span>
      {onDismiss && (
        <button type="button" className="btn btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
};
