import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@shared/routes';
import { marketViewerClient } from '@/lib/api/MarketViewerClient';
import { SwapInterface } from '@/components/SwapInterface';
import { NetworkSelector } from '@/components/NetworkSelector';
import { TokenMarketView } from '@/components/TokenMarketView';
import { Sidebar, SidebarProvider } from '@/components/ui/sidebar';
import type { TokenMetadata } from '@shared/schema';

export default function Dashboard() {
  const [selectedNetwork, setSelectedNetwork] = useState<number>(137); // Default to Polygon
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [isAddingToken, setIsAddingToken] = useState<boolean>(false);

  // This is the "cold path" query. It fetches a paginated list of basic token metadata.
  const { data: tokensData, isLoading, error } = useQuery<{
    tokens: TokenMetadata[];
    pagination: {
      currentPage: number;
      pageSize: number;
      totalTokens: number;
      totalPages: number;
    };
  }>({
    queryKey: ['tokens', 'metadata', selectedNetwork, currentPage], // Ensure this key is unique to this query
    queryFn: async () => {
      const url = new URL(api.tokens.getAll.path, window.location.origin);
      url.searchParams.append('chainId', String(selectedNetwork));
      url.searchParams.append('page', String(currentPage));
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.tokens)) {
        throw new Error('Invalid response format for token metadata');
      }
      return data;
    },
  });

  // Reset to page 1 when network changes
  const handleNetworkChange = (newNetwork: number) => {
    setSelectedNetwork(newNetwork);
    setCurrentPage(1);
  };

  const handleAddToken = async (address: string) => {
    setIsAddingToken(true);
    try {
      const result = await marketViewerClient.addToken(address, selectedNetwork);
      if (result.success) {
        console.log(`✅ Token added to quarantine: ${result.status}`);
        // You could show a toast notification here for success
      } else {
        console.error(`❌ Failed to add token: ${result.message}`);
        // You could show an error toast here
      }
    } catch (err) {
      console.error('Error adding token:', err);
    } finally {
      setIsAddingToken(false);
    }
  };

  if (error) {
    return <div className="p-8 text-red-600">Error loading token metadata: {error instanceof Error ? error.message : 'Unknown error'}</div>;
  }

  const paginatedTokens = tokensData?.tokens || [];

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
              <NetworkSelector selectedNetwork={selectedNetwork} onNetworkChange={handleNetworkChange} />
            </div>
          </div>

          {/* Content */}
          <div className="px-8 py-8">
            {/* Swap Card */}
            <div className="mb-12">
              {/* The SwapInterface might also need the full list of tokens for its dropdowns */}
              <SwapInterface tokens={paginatedTokens} chainId={selectedNetwork} />
            </div>
            {/* Market Overview */}
            {isLoading ? (
              <div className="text-center py-12 text-gray-500">Loading token list...</div>
            ) : (
              <>
                {/* Here we pass the paginated token metadata to the TokenMarketView */}
                <TokenMarketView
                  tokens={paginatedTokens}
                  chainId={selectedNetwork}
                  onAddToken={handleAddToken}
                  isAddingToken={isAddingToken}
                />
                {/* Pagination Controls */}
                {tokensData?.pagination && tokensData.pagination.totalPages > 1 && (
                  <div className="mt-8 flex items-center justify-between bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                    <div className="text-sm text-gray-600">
                      Page {tokensData.pagination.currentPage} of {tokensData.pagination.totalPages}
                      {' '}({tokensData.pagination.totalTokens} total tokens)
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => Math.min(tokensData.pagination.totalPages, p + 1))}
                        disabled={currentPage === tokensData.pagination.totalPages}
                        className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
