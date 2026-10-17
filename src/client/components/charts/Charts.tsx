import React from 'react';
import type { CategorySummaryItem, MonthlyCashFlowItem } from '../../../shared/types/index.js';
import { formatMinorUnits } from '../../../shared/utils/money.js';

export const IncomeExpenseBarChart: React.FC<{
  series: MonthlyCashFlowItem[];
  currency: string;
}> = ({ series, currency }) => {
  if (series.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '20px 10px' }}>
        <div className="empty-state-desc">No income or expense records for the selected period.</div>
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...series.flatMap((item) => [item.income_minor, Math.max(0, item.expense_minor)])
  );

  const chartHeight = 160;
  const barGroupWidth = 76;
  const svgWidth = Math.max(360, series.length * barGroupWidth + 40);

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${svgWidth} ${chartHeight + 45}`}
        role="img"
        aria-label="Income versus Expense Monthly Bar Chart"
        style={{ display: 'block', minWidth: '320px' }}
      >
        <line
          x1={20}
          y1={chartHeight + 10}
          x2={svgWidth - 20}
          y2={chartHeight + 10}
          stroke="#d1d5db"
          strokeWidth={1}
        />
        {series.map((item, idx) => {
          const xBase = 30 + idx * barGroupWidth;
          const incHeight = Math.round((Math.max(0, item.income_minor) / maxVal) * (chartHeight - 15));
          const expHeight = Math.round((Math.max(0, item.expense_minor) / maxVal) * (chartHeight - 15));

          return (
            <g key={item.month}>
              <rect
                x={xBase}
                y={chartHeight + 10 - incHeight}
                width={22}
                height={Math.max(2, incHeight)}
                fill="#15803d"
                rx={2}
              >
                <title>{`${item.month} Income: ${formatMinorUnits(item.income_minor, currency)}`}</title>
              </rect>
              <rect
                x={xBase + 25}
                y={chartHeight + 10 - expHeight}
                width={22}
                height={Math.max(2, expHeight)}
                fill="#b91c1c"
                rx={2}
              >
                <title>{`${item.month} Expense: ${formatMinorUnits(item.expense_minor, currency)}`}</title>
              </rect>
              <text
                x={xBase + 23}
                y={chartHeight + 28}
                textAnchor="middle"
                fontSize="11"
                fill="#4b5563"
              >
                {item.month}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: 'flex',
          gap: '16px',
          fontSize: '12px',
          color: '#4b5563',
          marginTop: '6px',
        }}
      >
        <span>
          <strong style={{ color: '#15803d' }}>■</strong> Income (+)
        </span>
        <span>
          <strong style={{ color: '#b91c1c' }}>■</strong> Expense (-)
        </span>
      </div>
    </div>
  );
};

export const CategoryBreakdownBars: React.FC<{
  items: CategorySummaryItem[];
  currency: string;
  onSelectCategory?: (categoryId: string) => void;
}> = ({ items, currency, onSelectCategory }) => {
  if (items.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '20px 10px' }}>
        <div className="empty-state-desc">No categorized activity in the selected period.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {items.map((item) => (
        <div
          key={item.category_id}
          onClick={() => onSelectCategory?.(item.category_id)}
          className={onSelectCategory ? 'clickable-row' : ''}
          style={{
            padding: '6px 8px',
            borderRadius: '4px',
            border: '1px solid #e5e7eb',
            backgroundColor: '#fafafa',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '13px',
              marginBottom: '4px',
            }}
          >
            <span>
              <strong>{item.category_name}</strong>{' '}
              <span style={{ color: '#6b7280', fontSize: '12px' }}>
                ({item.transaction_count} tx)
              </span>
            </span>
            <span className="num">
              <strong>{formatMinorUnits(item.amount_minor, currency)}</strong> ({item.percentage}%)
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: `${Math.min(100, Math.max(2, item.percentage))}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
};
