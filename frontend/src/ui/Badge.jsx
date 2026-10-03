import React from 'react';

const statusMap = {
  paid: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-100 text-red-800',
  refunded: 'bg-violet-100 text-violet-800',
  partially_refunded: 'bg-violet-100 text-violet-800',
  open: 'bg-orange-100 text-orange-800',
};

export function Badge({ status, children, className = '' }) {
  const tone = statusMap[status] || 'bg-slate-100 text-slate-700';
  return <span className={`badge ${tone} ${className}`}>{children || status}</span>;
}
