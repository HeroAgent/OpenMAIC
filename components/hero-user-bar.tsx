'use client';

import { useState, useEffect, useRef } from 'react';
import { User, LogOut, ExternalLink, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONSOLE_URL = 'https://herowith.com/console.html';
// Use relative path for same-origin API call via nginx proxy (avoids CORS)
// Fallback to absolute URL for direct access
const VERIFY_URL_RELATIVE = '/api/hero/verify';
const VERIFY_URL_ABSOLUTE = 'https://herowith.com/api/auth/verify';

function getHeroToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/hero_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function clearHeroToken() {
  document.cookie = 'hero_token=; path=/; domain=.herowith.com; max-age=0';
  document.cookie = 'hero_token=; path=/; max-age=0';
}

interface HeroUser {
  email: string;
  userId?: string;
}

export function HeroUserBar({ locale = 'zh-CN' }: { locale?: string }) {
  const [user, setUser] = useState<HeroUser | null>(null);
  const [quota, setQuota] = useState<{ remaining: number; limit: number; used: number } | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isZh = locale === 'zh-CN';

  useEffect(() => {
    const token = getHeroToken();
    if (!token) {
      setLoading(false);
      return;
    }
    fetch(VERIFY_URL_RELATIVE, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error('relative failed');
        return r.json();
      })
      .catch(() =>
        fetch(VERIFY_URL_ABSOLUTE, {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())
      )
      .then((data) => {
        if (data.ok && data.email) {
          setUser({ email: data.email, userId: data.userId });
          // After setting user, also fetch quota
          fetch('/api/hero/quota', {
            headers: { Authorization: `Bearer ${token}` },
          })
            .then((r) => r.ok ? r.json() : null)
            .then((data) => {
              if (data && data.quota) setQuota(data.quota);
            })
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleLogout = () => {
    clearHeroToken();
    window.location.href = CONSOLE_URL;
  };

  if (loading || !user) return null;

  // Truncate email for display
  const displayName = user.email.length > 18 ? user.email.slice(0, 16) + '…' : user.email;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 hover:shadow-sm transition-all max-w-[180px]"
      >
        <User className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{displayName}</span>
        <ChevronDown className={cn('w-3 h-3 shrink-0 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute top-full mt-2 left-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden z-50 min-w-[200px]">
          {/* User email */}
          <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
            <div className="text-xs text-gray-400 dark:text-gray-500">{isZh ? '已登录' : 'Signed in as'}</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate mt-0.5">{user.email}</div>
            {quota && (
              <div className="mt-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {isZh ? '配额' : 'Quota'}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {quota.limit - quota.remaining}/{quota.limit}
                  </span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1">
                  <div
                    className="bg-blue-500 dark:bg-blue-400 h-1 rounded-full transition-all"
                    style={{ width: `${Math.min(100, ((quota.limit - quota.remaining) / quota.limit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Back to console */}
          <a
            href={CONSOLE_URL}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors flex items-center gap-2 text-gray-600 dark:text-gray-300"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {isZh ? '返回控制台' : 'Back to Console'}
          </a>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full px-4 py-2.5 text-left text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center gap-2 text-red-500 dark:text-red-400"
          >
            <LogOut className="w-3.5 h-3.5" />
            {isZh ? '退出登录' : 'Sign Out'}
          </button>
        </div>
      )}
    </div>
  );
}
