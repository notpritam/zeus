import {
  FileCode,
  FileJson,
  FileText,
  FileImage,
  File,
  Folder,
  FolderOpen,
  Settings,
  Package,
  FileType,
  type LucideIcon,
} from 'lucide-react';

interface FileIconResult {
  icon: LucideIcon;
  color: string;
}

// Special filenames take priority over extension matching
const FILENAME_ICONS: Record<string, FileIconResult> = {
  'package.json': { icon: Package, color: 'text-green-400' },
  'package-lock.json': { icon: Package, color: 'text-green-400' },
  'yarn.lock': { icon: Package, color: 'text-blue-400' },
  'pnpm-lock.yaml': { icon: Package, color: 'text-yellow-400' },
  'tsconfig.json': { icon: Settings, color: 'text-blue-400' },
  'tsconfig.node.json': { icon: Settings, color: 'text-blue-400' },
  'tsconfig.web.json': { icon: Settings, color: 'text-blue-400' },
  '.gitignore': { icon: Settings, color: 'text-gray-500' },
  '.eslintrc': { icon: Settings, color: 'text-purple-400' },
  '.eslintrc.js': { icon: Settings, color: 'text-purple-400' },
  '.eslintrc.json': { icon: Settings, color: 'text-purple-400' },
  '.prettierrc': { icon: Settings, color: 'text-pink-400' },
  '.prettierrc.json': { icon: Settings, color: 'text-pink-400' },
  'vite.config.ts': { icon: Settings, color: 'text-purple-400' },
  'vite.config.js': { icon: Settings, color: 'text-purple-400' },
  'tailwind.config.ts': { icon: Settings, color: 'text-cyan-400' },
  'tailwind.config.js': { icon: Settings, color: 'text-cyan-400' },
  'postcss.config.js': { icon: Settings, color: 'text-orange-400' },
  'Dockerfile': { icon: Settings, color: 'text-blue-400' },
  'docker-compose.yml': { icon: Settings, color: 'text-blue-400' },
  'docker-compose.yaml': { icon: Settings, color: 'text-blue-400' },
  '.env': { icon: Settings, color: 'text-yellow-400' },
  '.env.local': { icon: Settings, color: 'text-yellow-400' },
  '.env.production': { icon: Settings, color: 'text-yellow-400' },
};

const EXT_ICONS: Record<string, FileIconResult> = {
  '.ts': { icon: FileCode, color: 'text-blue-400' },
  '.tsx': { icon: FileCode, color: 'text-blue-400' },
  '.js': { icon: FileCode, color: 'text-yellow-400' },
  '.jsx': { icon: FileCode, color: 'text-yellow-400' },
  '.mjs': { icon: FileCode, color: 'text-yellow-400' },
  '.cjs': { icon: FileCode, color: 'text-yellow-400' },
  '.css': { icon: FileType, color: 'text-purple-400' },
  '.scss': { icon: FileType, color: 'text-pink-400' },
  '.less': { icon: FileType, color: 'text-blue-300' },
  '.html': { icon: FileCode, color: 'text-orange-400' },
  '.json': { icon: FileJson, color: 'text-yellow-300' },
  '.md': { icon: FileText, color: 'text-gray-400' },
  '.mdx': { icon: FileText, color: 'text-gray-400' },
  '.txt': { icon: FileText, color: 'text-gray-400' },
  '.py': { icon: FileCode, color: 'text-green-400' },
  '.go': { icon: FileCode, color: 'text-cyan-400' },
  '.rs': { icon: FileCode, color: 'text-orange-500' },
  '.java': { icon: FileCode, color: 'text-red-400' },
  '.rb': { icon: FileCode, color: 'text-red-500' },
  '.php': { icon: FileCode, color: 'text-indigo-400' },
  '.c': { icon: FileCode, color: 'text-blue-300' },
  '.cpp': { icon: FileCode, color: 'text-blue-400' },
  '.h': { icon: FileCode, color: 'text-blue-300' },
  '.sh': { icon: FileCode, color: 'text-green-300' },
  '.bash': { icon: FileCode, color: 'text-green-300' },
  '.zsh': { icon: FileCode, color: 'text-green-300' },
  '.sql': { icon: FileCode, color: 'text-yellow-400' },
  '.yaml': { icon: FileCode, color: 'text-red-300' },
  '.yml': { icon: FileCode, color: 'text-red-300' },
  '.toml': { icon: FileCode, color: 'text-gray-400' },
  '.xml': { icon: FileCode, color: 'text-orange-300' },
  '.svg': { icon: FileImage, color: 'text-yellow-400' },
  '.png': { icon: FileImage, color: 'text-pink-400' },
  '.jpg': { icon: FileImage, color: 'text-pink-400' },
  '.jpeg': { icon: FileImage, color: 'text-pink-400' },
  '.gif': { icon: FileImage, color: 'text-pink-400' },
  '.webp': { icon: FileImage, color: 'text-pink-400' },
  '.ico': { icon: FileImage, color: 'text-pink-400' },
};

const DEFAULT_FILE: FileIconResult = { icon: File, color: 'text-gray-400' };

export function getFileIcon(name: string): FileIconResult {
  // Check exact filename first
  const lower = name.toLowerCase();
  if (FILENAME_ICONS[lower]) return FILENAME_ICONS[lower];
  if (FILENAME_ICONS[name]) return FILENAME_ICONS[name];

  // Check extension
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = name.slice(dotIdx).toLowerCase();
    if (EXT_ICONS[ext]) return EXT_ICONS[ext];
  }

  return DEFAULT_FILE;
}

export function getFolderIcon(isOpen: boolean): FileIconResult {
  return {
    icon: isOpen ? FolderOpen : Folder,
    color: 'text-yellow-500',
  };
}
