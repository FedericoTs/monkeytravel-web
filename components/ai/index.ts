// AI Agent Enhanced Components
// Phase 1 Implementation - December 2025

export { default as AIAssistant } from "./AIAssistant";
export { default as AssistantCards } from "./AssistantCards";
export {
  MiniActivityCard,
  ActivitySuggestionCard,
  ActivityReplacementCard,
  TipCard,
  ComparisonCard,
  ConfirmationCard,
} from "./AssistantCards";

// New Enhanced Components
export { default as StagedLoadingIndicator } from "./StagedLoadingIndicator";
export type { LoadingStage, LoadingStageConfig } from "./StagedLoadingIndicator";

export { default as TypingIndicator, TypingIndicatorCompact } from "./TypingIndicator";

export { default as PreviewChangeCard } from "./PreviewChangeCard";

export { default as MatchConfirmationDialog } from "./MatchConfirmationDialog";
export type { MatchOption, MatchConfirmationDialogProps } from "./MatchConfirmationDialog";

export { default as UndoToast, useUndoState } from "./UndoToast";
export type { UndoState } from "./UndoToast";
