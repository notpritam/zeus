import { Check, FolderOpen, RefreshCw } from 'lucide-react';
import { useZeusStore } from '@/stores/useZeusStore';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function ThemeCard({
  id,
  name,
  author,
  type,
  isActive,
  onClick,
}: {
  id: string;
  name: string;
  author?: string;
  type: 'dark' | 'light';
  isActive: boolean;
  onClick: () => void;
}) {
  // Use the theme's own colors for preview if we have them
  const activeThemeColors = useZeusStore((s) => s.activeThemeColors);
  const themes = useZeusStore((s) => s.themes);

  // For the active theme, use current colors; for others, we only have meta
  // We'll show a styled card that gives a sense of the theme
  const theme = themes.find((t) => t.id === id);
  const isDark = theme?.type === 'dark';

  return (
    <button
      onClick={onClick}
      className={`group relative flex flex-col overflow-hidden rounded-lg border-2 transition-all hover:scale-[1.02] ${
        isActive
          ? 'border-primary ring-primary/20 ring-2'
          : 'border-border hover:border-muted-foreground/30'
      }`}
    >
      {/* Preview area */}
      <div
        className={`flex h-16 items-end gap-1 p-2 ${isDark ? 'bg-[#1a1a1a]' : 'bg-[#f0f0f0]'}`}
      >
        {/* Mini window mockup */}
        <div
          className={`flex-1 rounded-t-sm ${isDark ? 'bg-[#111]' : 'bg-white'}`}
          style={{ height: '70%' }}
        >
          <div
            className={`h-1.5 rounded-t-sm ${isDark ? 'bg-[#222]' : 'bg-[#e0e0e0]'}`}
          />
          <div className="flex gap-0.5 p-1">
            <div
              className="h-1 w-3 rounded-sm"
              style={{ backgroundColor: isDark ? '#3b82f6' : '#2563eb' }}
            />
            <div
              className="h-1 w-5 rounded-sm opacity-40"
              style={{ backgroundColor: isDark ? '#888' : '#666' }}
            />
          </div>
        </div>
      </div>

      {/* Label area */}
      <div className="bg-bg-card flex items-center gap-1.5 px-2 py-1.5">
        {isActive && <Check className="text-primary size-3 shrink-0" />}
        <div className="min-w-0 flex-1 text-left">
          <div className="text-foreground truncate text-[11px] font-medium">
            {name}
          </div>
          {author && (
            <div className="text-muted-foreground truncate text-[9px]">
              by {author}
            </div>
          )}
        </div>
        <Badge
          variant="secondary"
          className="shrink-0 px-1 py-0 text-[8px]"
        >
          {type}
        </Badge>
      </div>
    </button>
  );
}

export default function ThemePicker() {
  const themes = useZeusStore((s) => s.themes);
  const activeThemeId = useZeusStore((s) => s.activeThemeId);
  const setTheme = useZeusStore((s) => s.setTheme);
  const refreshThemes = useZeusStore((s) => s.refreshThemes);
  const openThemesFolder = useZeusStore((s) => s.openThemesFolder);

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        Theme
      </h3>

      {/* Theme Grid */}
      <div className="grid grid-cols-2 gap-2">
        {themes.map((theme) => (
          <ThemeCard
            key={theme.id}
            id={theme.id}
            name={theme.name}
            author={theme.author}
            type={theme.type}
            isActive={theme.id === activeThemeId}
            onClick={() => setTheme(theme.id)}
          />
        ))}
      </div>

      {/* Custom Themes Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-6 flex-1 gap-1.5 text-[10px]"
          onClick={openThemesFolder}
        >
          <FolderOpen className="size-3" />
          Open Themes Folder
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1.5 text-[10px]"
          onClick={refreshThemes}
          title="Refresh themes"
        >
          <RefreshCw className="size-3" />
        </Button>
      </div>
    </div>
  );
}
