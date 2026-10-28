export interface EmptyStateProps {
  welcomeMessage: string;
  suggestions?: string[];
  onSuggestion: (text: string) => void;
}

export function EmptyState({ welcomeMessage, suggestions = [], onSuggestion }: EmptyStateProps) {
  return (
    <div className="dp-chat-empty">
      <p className="dp-chat-welcome">{welcomeMessage}</p>
      {suggestions.length > 0 ? (
        <ul className="dp-chat-suggestions" aria-label="Suggested questions">
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button type="button" className="dp-chat-chip" onClick={() => onSuggestion(suggestion)}>
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
