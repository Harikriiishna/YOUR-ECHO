/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AiMemoryModule } from './components/AiMemoryModule';
import { AuthScreen } from './components/AuthScreen';
import { HomeDashboard } from './components/HomeDashboard';
import { MemoriesModule } from './components/MemoriesModule';
import { DreamArchiveModule, LifeBehindObjectsModule } from './components/ObjectsAndDreamsModules';
import { DiscoverHub, ProfileSettingsView } from './components/ProfileAndDiscover';
import { ShellLayout } from './components/ShellLayout';
import { SkillSwapModule } from './components/SkillSwapModule';
import { TimeCapsuleModule } from './components/TimeCapsuleModule';
import { HumanityFeedModule, StrangersWisdomModule } from './components/WisdomAndHumanityModules';
import { EchoProvider, useEcho } from './context/EchoContext';

function EchoAppContent() {
  const { user, authLoading, activeModule } = useEcho();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#070B14] flex items-center justify-center">
        <div className="space-y-2 text-center">
          <div className="font-display text-2xl font-bold text-white tracking-tight">ECHO</div>
          <div className="text-xs text-slate-400">Connecting to your archive...</div>
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
