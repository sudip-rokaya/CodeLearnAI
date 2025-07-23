import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Github, Bot, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CommitDiff {
  sha: string;
  message: string;
  diff: string;
  explanation?: string;
}

interface GitCommit {
  sha: string;
  [key: string]: unknown;
}

interface RepoData {
  diffs: CommitDiff[];
}

const GitHubAnalyzer = () => {
  const [repoUrl, setRepoUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [openaiKey, setOpenaiKey] = useState("");
  const [githubToken, setGithubToken] = useState("");

  const [showLessons, setShowLessons] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { toast } = useToast();

  /* ------------------------- helpers ------------------------- */

  const extractRepoInfo = (url: string) => {
    try {
      const { pathname } = new URL(url);
      const [, owner, repo] = pathname.split("/");
      if (!owner || !repo) return null;
      return { owner, repo: repo.replace(".git", "") };
    } catch {
      return null;
    }
  };

  /* -------------------- GitHub processing -------------------- */

  const fetchRepoData = async () => {
    if (!repoUrl.trim()) {
      toast({
        title: "Invalid URL",
        description: "Please enter a valid GitHub repository URL",
        variant: "destructive",
      });
      return;
    }

    const repoInfo = extractRepoInfo(repoUrl);
    if (!repoInfo) {
      toast({
        title: "Invalid GitHub URL",
        description: "Please enter a valid GitHub repository URL",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      /** 1. Pull the complete commit list */
      const allCommits: GitCommit[] = [];
      const headers = githubToken
        ? { Authorization: `token ${githubToken}` }
        : {};
      let page = 1;
      const perPage = 100;

      while (true) {
        const commitsResponse = await fetch(
          `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?per_page=${perPage}&page=${page}`,
          { headers }
        );

        if (!commitsResponse.ok) {
          const msg =
            commitsResponse.status === 403
              ? "GitHub API rate limit reached. Provide a personal token."
              : "Failed to fetch commit history";
          throw new Error(msg);
        }

        const commitsPage: GitCommit[] = await commitsResponse.json();
        allCommits.push(...commitsPage);
        if (commitsPage.length < perPage) break; // last page reached
        page += 1;
      }

      /** 2. For every commit, fetch the per-file diff */
      const diffs: CommitDiff[] = [];

      for (const commit of allCommits) {
        try {
          const commitResponse = await fetch(
            `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${commit.sha}`,
            { headers }
          );

          if (!commitResponse.ok) {
            const msg =
              commitResponse.status === 403
                ? "GitHub API rate limit reached. Provide a personal token."
                : `Failed to fetch commit ${commit.sha}`;
            throw new Error(msg);
          }

          const commitDetails = await commitResponse.json();

          let diffText = "";
          if (commitDetails.files && commitDetails.files.length > 0) {
            commitDetails.files.forEach(
              (file: { filename: string; patch?: string }) => {
                if (file.patch) {
                  diffText += `### ${file.filename}\n\`\`\`diff\n${file.patch}\n\`\`\`\n`;
                }
              }
            );
          }

          diffs.push({
            sha: commit.sha,
            message: commit.commit?.message ?? "",
            diff: diffText,
          });
        } catch (error) {
          console.error(`Error fetching commit details for ${commit.sha}:`, error);
          if (
            error instanceof Error &&
            error.message.includes("rate limit")
          ) {
            toast({
              title: "GitHub rate limit",
              description:
                "GitHub API rate limit reached. Add a personal token and try again.",
              variant: "destructive",
            });
            break; // stop processing further commits
          }
        }
      }

      setRepoData({ diffs });

      toast({
        title: "Repository processed successfully",
        description: `Fetched ${diffs.length} commits`,
      });
    } catch (error) {
      console.error("Error processing repository:", error);
      toast({
        title: "Error",
        description:
          "Failed to process repository. Please check the URL and try again.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  /* ----------------------- AI analysis ----------------------- */

  const generateLesson = useCallback(
    async (index: number) => {
      if (!repoData || !openaiKey.trim()) {
        toast({
          title: "Missing data",
          description:
            "Please process a repository and enter your OpenAI API key",
          variant: "destructive",
        });
        return;
      }

      if (!openaiKey.trim().startsWith("sk-")) {
        toast({
          title: "Invalid API Key",
          description:
            "Your OpenAI API key should start with 'sk-'. Please check and try again.",
          variant: "destructive",
        });
        console.error("Invalid API key format");
        return;
      }

      setIsProcessing(true);
      try {
        const diff = repoData.diffs[index];
        if (!diff.diff) {
          toast({
            title: "No diff",
            description: "This commit has no diff available",
            variant: "destructive",
          });
          return;
        }

        let contentToAnalyze = `Commit message: ${diff.message}\n\n${diff.diff}`;
        if (contentToAnalyze.length > 50_000) {
          contentToAnalyze =
            contentToAnalyze.slice(0, 50_000) +
            "\n\n[Content truncated due to size limits]";
        }

        const requestBody = {
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content:
                "You are a professional software mentor. For each diff provided, write a thorough yet beginner-friendly lesson of around 500 words explaining what changed and why.",
            },
            { role: "user", content: contentToAnalyze },
          ],
          max_tokens: 3000,
          temperature: 0.7,
        };

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${openaiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!response.ok) {
          let errorMessage = `OpenAI API error: ${response.status}`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error?.message || errorMessage;
          } catch {
            /* ignore JSON parse failure */
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        if (!data.choices?.[0]?.message?.content) {
          throw new Error("Invalid response format from OpenAI API");
        }

        const newDiffs = [...repoData.diffs];
        newDiffs[index].explanation = data.choices[0].message.content;
        setRepoData({ diffs: newDiffs });

        toast({
          title: "Lesson generated",
          description: `Explanation created for commit ${diff.sha.substring(
            0,
            7
          )}`,
        });
      } catch (error) {
        console.error("Error analyzing with OpenAI:", error);
        toast({
          title: "Analysis failed",
          description:
            error instanceof Error
              ? error.message
              : "Failed to analyze repository. Please check your API key and try again.",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [openaiKey, repoData, toast]
  );

  /* ------------------------ lesson UI ------------------------ */

  const startLessons = () => {
    if (repoData?.diffs.length) {
      setCurrentIndex(0);
      setShowLessons(true);
      if (!repoData.diffs[0].explanation) generateLesson(0);
    }
  };

  useEffect(() => {
    if (
      showLessons &&
      repoData?.diffs[currentIndex] &&
      !repoData.diffs[currentIndex].explanation &&
      !isProcessing
    ) {
      generateLesson(currentIndex);
    }
  }, [showLessons, repoData, currentIndex, generateLesson, isProcessing]);

  /* --------------------------- JSX --------------------------- */

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Github className="h-8 w-8 text-primary" />
            <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
              GitHub Repository Analyzer
            </h1>
          </div>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Extract source code and commit history from any GitHub repository,
            then get AI-powered insights about the codebase.
          </p>
        </div>

        {/* Input Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              Repository Input
            </CardTitle>
            <CardDescription>
              Enter a GitHub repository URL to analyze
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="https://github.com/username/repository"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                className="flex-1"
              />
              <Button onClick={fetchRepoData} disabled={isProcessing}>
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Process"
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">OpenAI API Key</label>
              <Input
                type="password"
                placeholder="sk-..."
                value={openaiKey}
                onChange={(e) => setOpenaiKey(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Your API key is stored locally and never saved
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                GitHub Token (optional)
              </label>
              <Input
                type="password"
                placeholder="ghp_..."
                value={githubToken}
                onChange={(e) => setGithubToken(e.target.value)}
                className="font-mono"
              />
            </div>
          </CardContent>
        </Card>

        {/* Results Section */}
        {repoData && !showLessons && (
          <div className="space-y-6">
            <div className="text-right">
              <Button onClick={startLessons}>Generate Lessons</Button>
            </div>

            {repoData.diffs.map((d, idx) => (
              <Card key={d.sha}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    {d.sha.substring(0, 7)}
                  </CardTitle>
                  <CardDescription>{d.message}</CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                  <Textarea
                    value={d.diff}
                    readOnly
                    className="min-h-[300px] font-mono text-xs bg-code-bg border-code-border"
                  />

                  {d.explanation && (
                    <div className="prose prose-sm max-w-none dark:prose-invert">
                      <pre className="whitespace-pre-wrap bg-code-bg p-4 rounded-lg border border-code-border text-sm">
                        {d.explanation}
                      </pre>
                    </div>
                  )}

                  <Button
                    onClick={() => generateLesson(idx)}
                    disabled={isProcessing || !openaiKey.trim()}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4 mr-2" />
                        {d.explanation ? "Regenerate Lesson" : "Generate Lesson"}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Lesson Viewer */}
        {repoData && showLessons && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-5 w-5" />
                  {repoData.diffs[currentIndex].sha.substring(0, 7)}
                </CardTitle>
                <CardDescription>
                  {repoData.diffs[currentIndex].message}
                </CardDescription>
                <p className="text-sm text-muted-foreground">
                  Lesson {currentIndex + 1} of {repoData.diffs.length}
                </p>
              </CardHeader>

              <CardContent className="space-y-4">
                {repoData.diffs[currentIndex].explanation ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <pre className="whitespace-pre-wrap bg-code-bg p-4 rounded-lg border border-code-border text-sm">
                      {repoData.diffs[currentIndex].explanation}
                    </pre>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                    {isProcessing ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : (
                      <p>Generating lesson...</p>
                    )}
                  </div>
                )}

                <div className="flex justify-between gap-2">
                  <Button variant="secondary" onClick={() => setShowLessons(false)}>
                    Exit
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setCurrentIndex((i) => Math.max(i - 1, 0))
                      }
                      disabled={currentIndex === 0 || isProcessing}
                    >
                      Prev
                    </Button>
                    <Button
                      onClick={() =>
                        setCurrentIndex((i) =>
                          Math.min(i + 1, repoData.diffs.length - 1)
                        )
                      }
                      disabled={
                        currentIndex >= repoData.diffs.length - 1 || isProcessing
                      }
                    >
                      {currentIndex >= repoData.diffs.length - 1
                        ? "Done"
                        : "Next"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitHubAnalyzer;
