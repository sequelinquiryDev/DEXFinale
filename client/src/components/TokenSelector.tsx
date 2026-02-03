interface TokenMetadata {
  address: string;
  symbol: string;
  name?: string;
  logoURI?: string;
}

interface TokenSelectorProps {
  tokens: TokenMetadata[];
  selectedToken: TokenMetadata | null;
  onSelectToken: (token: TokenMetadata) => void;
}

export function TokenSelector({ tokens, selectedToken, onSelectToken }: TokenSelectorProps) {
  return (
    <div className="space-y-2">
      <select 
        onChange={(e) => {
          const token = tokens.find(t => t.address === e.target.value);
          if (token) {
            onSelectToken(token);
          }
        }}
        value={selectedToken?.address || ''}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="" disabled>Select a token</option>
        {tokens.map(token => (
          <option key={token.address} value={token.address}>
            {token.logoURI ? '🖼️ ' : ''}{token.symbol} {token.name ? `(${token.name})` : ''}
          </option>
        ))}
      </select>
      {selectedToken && (
        <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
          {selectedToken.logoURI && (
            <img 
              src={selectedToken.logoURI} 
              alt={selectedToken.symbol} 
              className="w-6 h-6 rounded-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          )}
          <span className="text-sm font-semibold">{selectedToken.symbol}</span>
          {selectedToken.name && (
            <span className="text-xs text-gray-600">{selectedToken.name}</span>
          )}
        </div>
      )}
    </div>
  );
}
