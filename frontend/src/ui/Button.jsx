import React from 'react';

const variants = {
  primary: 'btn-primary',
  ink: 'btn-ink',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
  ghost: 'btn-ghost',
};

export function Button({ variant = 'ink', className = '', type = 'button', children, ...props }) {
  return (
    <button type={type} className={`${variants[variant] || variants.ink} ${className}`} {...props}>
      {children}
    </button>
  );
}
