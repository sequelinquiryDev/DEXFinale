import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { SwapInterface, TokenMetadata } from '@/components/SwapInterface';
import { NetworkSelector } from '@/components/NetworkSelector';
import { TokenMarketView } from '@/components/TokenMarketView';
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar';

export default function Dashboard() {
  const [selectedNetwork, setSelectedNetwork] = useState<number>(137); // Default to Polygon

  const { data: tokens, isLoading, error } = useQuery<{
    tokens: TokenMetadata[];
  }>({
    queryKey: ['tokens', selectedNetwork],
    queryFn: async () => {
      const url = new URL(api.tokens.getAll.path, window.location.origin);
      url.searchParams.append('chainId', String(selectedNetwork));
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.tokens)) {
        throw new Error('Invalid response format');
      }
      return data;
    },
  });

  const mockMarketTokens = tokens?.tokens?.map(token => ({
    address: token.address,
    symbol: token.symbol,
    name: token.symbol, // In a real app, fetch from metadata
    price: Math.random() * 5000,
    marketCap: Math.random() * 1e12,
    liquidity: Math.random() * 1e9,
    volume24h: Math.random() * 1e9,
    change24h: (Math.random() - 0.5) * 20,
  })) || [];

  const handleAddToken = async (address: string) => {
    try {
      console.log('Adding token:', address, 'on network:', selectedNetwork);
      // This would trigger the discovery service in a real implementation
      // For now, just log the action
    } catch (err) {
      console.error('Error adding token:', err);
    }
  };

  if (error) {
    return <div className="p-8 text-red-600">Error loading tokens: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  return (
    <SidebarProvider>
      <div className="flex">
        <Sidebar />
        <main className="flex-1 bg-gradient-to-br from-slate-100 to-slate-50 min-h-screen">
          {/* Header */}
          <div className="bg-white shadow-sm border-b border-gray-200">
            <div className="px-8 py-6 flex justify-between items-center">
              <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">
                DEX Aggregator
              </h1>
              <NetworkSelector selectedNetwork={selectedNetwork} onNetworkChange={setSelectedNetwork} />
            </div>
          </div>

          {/* Content */}
          <div className="px-8 py-8">
            {/* Swap Card */}
            <div className="mb-12">
              <SwapInterface tokens={tokens?.tokens || []} chainId={selectedNetwork} />
            </div>
            {/* Market Overview */}
            {isLoading ? (
              <div className="text-center py-12 text-gray-500">Loading tokens...</div>
            ) : (
              <TokenMarketView chainId={selectedNetwork} />
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
