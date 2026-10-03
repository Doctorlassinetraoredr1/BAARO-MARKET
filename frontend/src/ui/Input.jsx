import React from 'react';

export function Input({ className = '', ...props }) {
  return <input className={`input ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`input ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...props }) {
  return <textarea className={`input ${className}`} {...props} />;
}
