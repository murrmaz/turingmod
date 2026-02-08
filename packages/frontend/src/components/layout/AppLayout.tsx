import CloudscapeAppLayout from '@cloudscape-design/components/app-layout';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Navigation } from './Navigation';

/**
 * Main application layout
 * Provides consistent structure across all pages
 */
export function AppLayout() {
  return (
    <>
      <Header />
      <CloudscapeAppLayout
        navigation={<Navigation />}
        content={<Outlet />}
        toolsHide={true}
        navigationWidth={200}
        headerSelector="#app-header"
      />
    </>
  );
}
