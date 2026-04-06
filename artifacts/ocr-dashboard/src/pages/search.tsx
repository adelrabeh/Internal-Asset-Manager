import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileText, ChevronRight, ChevronLeft } from "lucide-react";
import { STATUS_CONFIG } from "./jobs";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

async function searchOcr(q: string, page: number) {
  const r = await fetch(`${BASE}/api/search?q=${encodeURIComponent(q)}&page=${page}`, {
    credentials: "include",
  });
  if (!r.ok) throw new Error("فشل البحث");
  return r.json() as Promise<{
    results: Array<{
      jobId: number;
      originalFilename: string;
      status: string;
      createdAt: string;
      snippet: string;
      confidenceScore: number;
    }>;
    total: number;
    page: number;
    query: string;
  }>;
}

export default function SearchPage() {
  const [inputValue, setInputValue] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const searchEnabled = query.length >= 2;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["search", query, page],
    queryFn: () => searchOcr(query, page),
    enabled: searchEnabled,
  });

  const handleSearch = useCallback(() => {
    setPage(1);
    setQuery(inputValue.trim());
  }, [inputValue]);

  const totalPages = data ? Math.ceil(data.total / 20) : 1;

  // Highlight matching text in snippet
  function highlightSnippet(snippet: string, q: string) {
    if (!q) return snippet;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return snippet.replace(regex, '<mark class="bg-yellow-200 dark:bg-yellow-800 rounded px-0.5">$1</mark>');
  }

  return (
    <div className="space-y-4" dir="rtl">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            البحث في نصوص الوثائق
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="ابحث في النصوص المستخرجة..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1 text-right"
              data-testid="input-search"
            />
            <Button onClick={handleSearch} disabled={inputValue.trim().length < 2} data-testid="button-search">
              <Search className="w-4 h-4" />
              بحث
            </Button>
          </div>
          {query && !searchEnabled && (
            <p className="text-xs text-amber-600 mt-2">أدخل حرفين على الأقل للبحث</p>
          )}
          {searchEnabled && (
            <p className="text-xs text-muted-foreground mt-2">
              {isLoading || isFetching
                ? "جاري البحث..."
                : data
                  ? `${data.total} نتيجة للبحث عن "${query}"`
                  : ""}
            </p>
          )}
        </CardContent>
      </Card>

      {searchEnabled && (isLoading || isFetching) ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : data && data.results.length > 0 ? (
        <>
          <div className="space-y-2">
            {data.results.map((r) => {
              const statusConf = STATUS_CONFIG[r.status as keyof typeof STATUS_CONFIG];
              return (
                <Link key={r.jobId} href={`/jobs/${r.jobId}`}>
                  <Card className="shadow-sm hover:border-primary/50 transition-colors cursor-pointer">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-primary shrink-0" />
                          <span className="font-medium text-sm truncate">{r.originalFilename}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {statusConf && (
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusConf.cls}`}>
                              {statusConf.label}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {Math.round(r.confidenceScore * 100)}%
                          </span>
                        </div>
                      </div>
                      <p
                        className="text-xs text-muted-foreground leading-relaxed font-arabic"
                        dangerouslySetInnerHTML={{ __html: highlightSnippet(r.snippet, query) }}
                      />
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        {new Date(r.createdAt).toLocaleDateString("ar-SA")}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="icon" className="w-8 h-8" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
              <Button variant="outline" size="icon" className="w-8 h-8" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      ) : query.length >= 2 && data?.results.length === 0 ? (
        <Card className="shadow-sm">
          <CardContent className="py-16 text-center text-muted-foreground">
            <Search className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>لا توجد نتائج للبحث عن "{query}"</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
