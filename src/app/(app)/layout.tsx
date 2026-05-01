import React from 'react';
import AppShell from '@/components/layout/AppShell';

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  return <AppShell>{children}</AppShell>;
};

export default AppLayout;