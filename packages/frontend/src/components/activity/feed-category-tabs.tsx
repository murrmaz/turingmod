import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FEED_CATEGORY_LABELS, type FeedCategory } from '@/lib/activityFormat';

/**
 * Tabs that filter an activity table by category: All, then each of `categories` in the order
 * given. The live feed offers Chat; History doesn't, since chat isn't stored.
 */
export function FeedCategoryTabs<C extends FeedCategory>({
  categories,
  value,
  onChange,
}: {
  categories: readonly C[];
  value: C | 'all';
  onChange: (value: C | 'all') => void;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        const category = next === 'all' ? 'all' : categories.find((c) => c === next);
        if (category !== undefined) {
          onChange(category);
        }
      }}
    >
      <TabsList>
        <TabsTrigger value="all" className="px-3 text-[13px]">
          All
        </TabsTrigger>
        {categories.map((category) => (
          <TabsTrigger key={category} value={category} className="px-3 text-[13px]">
            {FEED_CATEGORY_LABELS[category]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
