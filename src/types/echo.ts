import type { EchoThemeId } from '../lib/themes';

export type ModuleId =
  | 'home'
  | 'memories'
  | 'memory-map'
  | 'ai'
  | 'capsules'
  | 'wisdom'
  | 'skillswap'
  | 'objects'
  | 'dreams'
  | 'humanity'
  | 'discover'
  | 'profile';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  phoneNumber?: string | null;
  authProvider?: string;
  bio: string;
  avatarMediaId: string | null;
  locationHint: string;
  timezone: string;
  theme?: EchoThemeId;
  emailVerified: boolean;
  aiConsent: boolean;
  totpEnabled?: boolean;
  totpDisplayName?: string | null;
  totpEnrolledAt?: string | null;
  notificationPrefs: Record<string, boolean>;
  createdAt: string;
}

export interface MfaFactorHint {
  factorId: string;
  uid: string;
  displayName: string;
}

export interface AuthSessionOrMfaResponse {
  user?: AuthUser;
  token?: string;
  mfaRequired?: boolean;
  challengeToken?: string;
  factors?: MfaFactorHint[];
  hintLabel?: string;
}

export interface MediaMeta {
  id: string;
  original_name?: string;
  originalName?: string;
  mime_type?: string;
  mimeType?: string;
  size_bytes?: number;
  sizeBytes?: number;
  transcript?: string;
}

export interface MemoryItem {
  id: string;
  title: string;
  content: string;
  memoryDate: string;
  locationName: string;
  latitude: number | null;
  longitude: number | null;
  mood: string;
  category: string;
  isFavorite: boolean;
  aiExcluded: boolean;
  aiSummary: string;
  sentimentTone: string;
  emotionalImpact: string;
  sentimentScore: number | null;
  sentimentRationale: string;
  collectionId: string | null;
  tags: string[];
  people: string[];
  media: MediaMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryCollection {
  id: string;
  name: string;
  description: string;
  color: string;
  memory_count: number;
  created_at: string;
}

export interface TimeCapsuleItem {
  id: string;
  title: string;
  message: string | null;
  capsuleType: string;
  unlockOccasion: string;
  unlockAt: string;
  timezone: string;
  isLocked: boolean;
  isMatured: boolean;
  isOpenable: boolean;
  openedAt: string | null;
  media: MediaMeta[];
  createdAt: string;
  updatedAt: string;
}

export interface AnonymousReply {
  id: string;
  anonymousHandle: string;
  isMine: boolean;
  content: string;
  createdAt: string;
}

export interface WisdomPost {
  id: string;
  anonymousHandle: string;
  isMine: boolean;
  postType: string;
  category: string;
  title: string;
  content: string;
  helpfulCount: number;
  resonateCount: number;
  userHelpful: boolean;
  userResonate: boolean;
  userSaved: boolean;
  replies: AnonymousReply[];
  createdAt: string;
}

export interface HumanityPost {
  id: string;
  anonymousHandle: string;
  isMine: boolean;
  category: string;
  title: string;
  content: string;
  approxRegion: string;
  approxLat: number | null;
  approxLng: number | null;
  helpfulCount: number;
  userHelpful: boolean;
  userSaved: boolean;
  replies: AnonymousReply[];
  createdAt: string;
}

export interface SkillProfile {
  userId: string;
  displayName?: string;
  teachSkills: string[];
  learnSkills: string[];
  experienceLevel: string;
  bio: string;
  languages: string[];
  availability: string;
  mode: string;
  locationCity: string;
  portfolioUrl: string;
  interests: string[];
  theyTeachWhatIWant?: string[];
  theyWantWhatITeach?: string[];
  isMutualMatch?: boolean;
  matchScore?: number;
}

export interface SkillExchange {
  id: string;
  requesterId: string;
  recipientId: string;
  requesterName: string;
  recipientName: string;
  offeredSkill: string;
  requestedSkill: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'scheduled' | 'completed';
  scheduledAt: string | null;
  sessionNotes: string;
  requesterConfirmed: boolean;
  recipientConfirmed: boolean;
  feedbackRating: number | null;
  feedbackNote: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExchangeMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

export interface EchoObject {
  id: string;
  name: string;
  category: string;
  photoMediaId: string | null;
  voiceMediaId: string | null;
  description: string;
  story: string;
  acquisitionDate: string;
  currentOwner: string;
  previousOwners: string[];
  connectedPeople: string[];
  location: string;
  historicalNotes: string;
  relatedMemoryIds: string[];
  tags: string[];
  isPublic: boolean;
  shareSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DreamItem {
  id: string;
  title: string;
  content: string;
  dreamDate: string;
  emotion: string;
  location: string;
  category: string;
  vividness: number;
  isRecurring: boolean;
  tags: string[];
  imageMediaId: string | null;
  voiceMediaId: string | null;
  transcript: string;
  aiReflection: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  linkModule: ModuleId;
  linkId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface SearchResult {
  id: string;
  module: ModuleId;
  title: string;
  subtitle: string;
  date: string;
}

export interface AiSource {
  kind: 'memory' | 'dream' | 'object' | 'capsule';
  id: string;
  title: string;
  date: string;
}

export interface AiChatMessage {
  id: string;
  module: string;
  role: 'user' | 'assistant';
  content: string;
  sources: AiSource[];
  createdAt: string;
}

export interface PendingOfflineMutation {
  clientMutationId: string;
  endpoint: '/memories' | '/dreams';
  payload: Record<string, unknown>;
  label: string;
  queuedAt: string;
}
