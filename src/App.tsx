/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { AiMemoryModule } from './components/AiMemoryModule';
import { AuthScreen } from './components/AuthScreen';
import { HomeDashboard } from './components/HomeDashboard';
import { MemoriesModule } from './components/MemoriesModule';
import { MemoryMapPage } from './components/MemoryMapPage';
import { DreamArchiveModule, LifeBehindObjectsModule } from './components/ObjectsAndDreamsModules';
import { DiscoverHub, ProfileSettingsView } from './components/ProfileAndDiscover';
import { SharedObjectViewer } from './components/SharedObjectViewer';
import { ShellLayout } from './components/ShellLayout';
import { SkillSwapModule } from './components/SkillSwapModule';
import { TimeCapsuleModule } from './components/TimeCapsuleModule';
import { HumanityFeedModule, StrangersWisdomModule } from './components/WisdomAndHumanityModules';
import { EchoProvider, useEcho } from './context/EchoContext';
import { useMobileKeyboardState } from './lib/mobileKeyboard';

function EchoAppContent() {
  const { user, authLoading, activeModule } = useEcho();
  useMobileKeyboardState();
  const [sharedObjectSlug, setSharedObjectSlug] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('sharedObject');
  });

  if (sharedObjectSlug) {
    return (
      <SharedObjectViewer
        slug={sharedObjectSlug}
        onClose={() => {
          window.history.replaceState({}, '', '/');
          setSharedObjectSlug(null);
        }}
      />
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-transparent text-ink flex items-center justify-center">
        <div className="space-y-2 text-center">
          <div className="font-display text-2xl font-bold text-ink tracking-tight">ECHO</div>
          <div className="text-xs text-ink-muted">Connecting to your archive...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  return (
    <ShellLayout>
      {activeModule === 'home' && <HomeDashboard />}
      {activeModule === 'memories' && <MemoriesModule />}
      {activeModule === 'memory-map' && <MemoryMapPage />}
      {activeModule === 'ai' && <AiMemoryModule />}
      {activeModule === 'capsules' && <TimeCapsuleModule />}
      {activeModule === 'wisdom' && <StrangersWisdomModule />}
      {activeModule === 'skillswap' && <SkillSwapModule />}
      {activeModule === 'objects' && <LifeBehindObjectsModule />}
      {activeModule === 'dreams' && <DreamArchiveModule />}
      {activeModule === 'humanity' && <HumanityFeedModule />}
      {activeModule === 'discover' && <DiscoverHub />}
      {activeModule === 'profile' && <ProfileSettingsView />}
    </ShellLayout>
  );
}

export default function App() {
  return (
    <EchoProvider>
      <EchoAppContent />
    </EchoProvider>
  );
}
