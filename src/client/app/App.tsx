import React, { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/apiClient.js';
import type { Account, AppSettings, Category } from '../../shared/types/index.js';
import type { NavPageId } from './navigation.js';
import { Sidebar } from '../components/layout/Sidebar.js';
import { DashboardView } from '../features/dashboard/DashboardView.js';
import { TransactionsView } from '../features/transactions/TransactionsView.js';
import { AccountsView } from '../features/accounts/AccountsView.js';
import { BudgetsView } from '../features/budgets/BudgetsView.js';
import { RecurringView } from '../features/recurring/RecurringView.js';
import { GoalsView } from '../features/goals/GoalsView.js';
import { ReportsView } from '../features/reports/ReportsView.js';
import { SettingsView } from '../features/settings/SettingsView.js';
import { TransactionModal } from '../features/transactions/TransactionModal.js';
import { CsvImportModal } from '../features/imports/CsvImportModal.js';
import { AlertBanner } from '../components/feedback/Feedback.js';

export const App: React.FC = () => {
  const [activePage, setActivePage] = useState<NavPageId>('dashboard');
  const [settings, setSettings] = useState<AppSettings>({
    base_currency: 'USD',
    date_format: 'YYYY-MM-DD',
    default_period: 'this_month',
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Deep-link filter state when navigating to Transactions from Dashboard/Budgets/Accounts
  const [txInitialCategoryId, setTxInitialCategoryId] = useState<string | undefined>(undefined);
  const [txInitialAccountId, setTxInitialAccountId] = useState<string | undefined>(undefined);

  // Global modals
  const [isQuickTxModalOpen, setIsQuickTxModalOpen] = useState<boolean>(false);
  const [isCsvModalOpen, setIsCsvModalOpen] = useState<boolean>(false);

  const loadCoreData = useCallback(async () => {
    try {
      const [loadedSettings, loadedAccounts, loadedCategories] = await Promise.all([
        apiClient.getSettings(),
        apiClient.getAccounts(true),
        apiClient.getCategories({ includeArchived: true }),
      ]);
      setSettings(loadedSettings);
      setAccounts(loadedAccounts);
      setCategories(loadedCategories);
    } catch (err) {
      setGlobalError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadCoreData();
  }, [loadCoreData, refreshTrigger]);

  const triggerGlobalRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const handleNavigate = (
    page: NavPageId,
    filters?: { categoryId?: string; accountId?: string }
  ) => {
    if (page === 'transactions') {
      setTxInitialCategoryId(filters?.categoryId ?? '');
      setTxInitialAccountId(filters?.accountId ?? '');
    }
    setActivePage(page);
  };

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        onSelectPage={(page) => handleNavigate(page)}
        onNewTransaction={() => setIsQuickTxModalOpen(true)}
        onOpenCsvImport={() => setIsCsvModalOpen(true)}
        baseCurrency={settings.base_currency}
      />

      <main className="main-workspace">
        <div className="page-container">
          {globalError && (
            <AlertBanner
              type="error"
              message={globalError}
              onDismiss={() => setGlobalError(null)}
            />
          )}

          {activePage === 'dashboard' && (
            <DashboardView
              settings={settings}
              refreshTrigger={refreshTrigger}
              onNavigate={handleNavigate}
              onNewTransaction={() => setIsQuickTxModalOpen(true)}
            />
          )}

          {activePage === 'transactions' && (
            <TransactionsView
              settings={settings}
              accounts={accounts}
              categories={categories}
              initialCategoryId={txInitialCategoryId}
              initialAccountId={txInitialAccountId}
              refreshTrigger={refreshTrigger}
              onDataMutated={triggerGlobalRefresh}
              onOpenCsvImport={() => setIsCsvModalOpen(true)}
            />
          )}

          {activePage === 'accounts' && (
            <AccountsView
              settings={settings}
              accounts={accounts}
              categories={categories}
              onDataMutated={triggerGlobalRefresh}
              onViewAccountTransactions={(accountId) =>
                handleNavigate('transactions', { accountId })
              }
            />
          )}

          {activePage === 'budgets' && (
            <BudgetsView
              settings={settings}
              categories={categories}
              refreshTrigger={refreshTrigger}
              onDataMutated={triggerGlobalRefresh}
              onInspectCategoryTransactions={(categoryId) =>
                handleNavigate('transactions', { categoryId })
              }
            />
          )}

          {activePage === 'recurring' && (
            <RecurringView
              settings={settings}
              accounts={accounts}
              categories={categories}
              refreshTrigger={refreshTrigger}
              onDataMutated={triggerGlobalRefresh}
            />
          )}

          {activePage === 'goals' && (
            <GoalsView
              settings={settings}
              accounts={accounts}
              refreshTrigger={refreshTrigger}
              onDataMutated={triggerGlobalRefresh}
            />
          )}

          {activePage === 'reports' && (
            <ReportsView
              settings={settings}
              accounts={accounts}
              categories={categories}
              refreshTrigger={refreshTrigger}
            />
          )}

          {activePage === 'settings' && (
            <SettingsView
              settings={settings}
              categories={categories}
              onDataMutated={triggerGlobalRefresh}
            />
          )}
        </div>
      </main>

      <TransactionModal
        isOpen={isQuickTxModalOpen}
        onClose={() => setIsQuickTxModalOpen(false)}
        onSaved={triggerGlobalRefresh}
        accounts={accounts}
        categories={categories}
      />

      <CsvImportModal
        isOpen={isCsvModalOpen}
        onClose={() => setIsCsvModalOpen(false)}
        onImportCompleted={triggerGlobalRefresh}
        accounts={accounts}
        categories={categories}
        settings={settings}
      />
    </div>
  );
};
