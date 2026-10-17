import React from 'react';
import { MAIN_NAVIGATION, type NavPageId } from '../../app/navigation.js';

interface SidebarProps {
  activePage: NavPageId;
  onSelectPage: (page: NavPageId) => void;
  onNewTransaction: () => void;
  onOpenCsvImport: () => void;
  baseCurrency: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activePage,
  onSelectPage,
  onNewTransaction,
  onOpenCsvImport,
  baseCurrency,
}) => {
  return (
    <aside className="sidebar" aria-label="Main Navigation">
      <div className="sidebar-brand">
        <h1 className="sidebar-brand-title">LedgerDesk</h1>
        <div className="sidebar-brand-subtitle">Private Offline Finance Manager</div>
      </div>

      <div className="sidebar-quick-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={onNewTransaction}
          style={{ width: '100%' }}
        >
          + Record Transaction
        </button>
        <button
          type="button"
          className="btn"
          onClick={onOpenCsvImport}
          style={{ width: '100%', backgroundColor: '#252830', color: '#e5e7eb', borderColor: '#374151' }}
        >
          Import CSV
        </button>
      </div>

      <nav>
        <ul className="sidebar-nav">
          {MAIN_NAVIGATION.map((item) => {
            const isActive = activePage === item.id;
            return (
              <li key={item.id} className="sidebar-nav-item">
                <button
                  type="button"
                  className={`sidebar-nav-button ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelectPage(item.id)}
                >
                  <span>{item.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div>Mode: 100% Local Offline (127.0.0.1)</div>
        <div>Base Currency: {baseCurrency}</div>
      </div>
    </aside>
  );
};

interface PageHeaderProps {
  title: string;
  description: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({ title, description, actions }) => {
  return (
    <header className="page-header">
      <div>
        <h2 className="page-title">{title}</h2>
        <p className="page-description">{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
};
