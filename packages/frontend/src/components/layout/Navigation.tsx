import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import SideNavigation from '@cloudscape-design/components/side-navigation';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * Side navigation
 * Provides navigation links to different sections
 */
export function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();

  const items: SideNavigationProps['items'] = [
    {
      type: 'link',
      text: 'Dashboard',
      href: '/dashboard',
    },
    {
      type: 'link',
      text: 'Commands',
      href: '/commands',
    },
    {
      type: 'link',
      text: 'Integrations',
      href: '/integrations',
    },
  ];

  return (
    <SideNavigation
      activeHref={location.pathname}
      items={items}
      onFollow={(event) => {
        event.preventDefault();
        navigate(event.detail.href);
      }}
    />
  );
}
