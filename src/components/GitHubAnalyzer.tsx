import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Github, Bot, FileText, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface RepoData {
  sourceCode: string;
  commitHistory: string;
  combinedContent: string;
}

const GitHubAnalyzer = () => {
  const [repoUrl, setRepoUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [analysis, setAnalysis] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const { toast } = useToast();

  const extractRepoInfo = (url: string) => {
    const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(".git", "") };
  };

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
      // Fetch repository contents
      const contentsResponse = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents`
      );

      if (!contentsResponse.ok) {
        throw new Error("Failed to fetch repository contents");
      }

      const contents = await contentsResponse.json();

      // Fetch commit history
      const commitsResponse = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?per_page=50`
      );

      if (!commitsResponse.ok) {
        throw new Error("Failed to fetch commit history");
      }

      const commits = await commitsResponse.json();

      // Process source code files
      let sourceCode = `# Source Code for ${repoInfo.owner}/${repoInfo.repo}\n\n`;

      const processFileContents = async (items: any[], path = "") => {
        for (const item of items) {
          if (
            item.type === "file" &&
            (item.name.endsWith(".js") ||
              item.name.endsWith(".ts") ||
              item.name.endsWith(".tsx") ||
              item.name.endsWith(".jsx") ||
              item.name.endsWith(".py") ||
              item.name.endsWith(".java") ||
              item.name.endsWith(".cpp") ||
              item.name.endsWith(".c") ||
              item.name.endsWith(".md") ||
              item.name.endsWith(".txt") ||
              item.name.endsWith(".json") ||
              item.name.endsWith(".yml") ||
              item.name.endsWith(".yaml"))
          ) {
            try {
              const fileResponse = await fetch(item.download_url);
              const fileContent = await fileResponse.text();
              sourceCode += `## File: ${path}${item.name}\n\`\`\`\n${fileContent}\n\`\`\`\n\n`;
            } catch (error) {
              console.error(`Error fetching file ${item.name}:`, error);
            }
          } else if (
            item.type === "dir" &&
            !item.name.startsWith(".") &&
            item.name !== "node_modules"
          ) {
            try {
              const dirResponse = await fetch(item.url);
              const dirContents = await dirResponse.json();
              await processFileContents(dirContents, `${path}${item.name}/`);
            } catch (error) {
              console.error(`Error fetching directory ${item.name}:`, error);
            }
          }
        }
      };

      await processFileContents(contents);

      // Process commit history with detailed changes
      let commitHistory = `# Commit History for ${repoInfo.owner}/${repoInfo.repo}\n\n`;

      for (const commit of commits) {
        commitHistory += `## Commit: ${commit.sha.substring(0, 7)}\n`;
        commitHistory += `**Author:** ${commit.commit.author.name} <${commit.commit.author.email}>\n`;
        commitHistory += `**Date:** ${new Date(
          commit.commit.author.date
        ).toLocaleString()}\n`;
        commitHistory += `**Message:** ${commit.commit.message}\n`;

        try {
          // Fetch detailed commit data including file changes
          const commitResponse = await fetch(
            `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${commit.sha}`
          );
          if (commitResponse.ok) {
            const commitDetails = await commitResponse.json();

            if (commitDetails.files && commitDetails.files.length > 0) {
              commitHistory += `**Files Changed:** ${commitDetails.files.length}\n`;
              commitHistory += `**Changes:**\n`;

              commitDetails.files.forEach((file: any) => {
                commitHistory += `\n### ${file.filename}\n`;
                commitHistory += `- Status: ${file.status}\n`;
                commitHistory += `- Additions: +${
                  file.additions || 0
                }, Deletions: -${file.deletions || 0}\n`;

                if (file.patch && file.patch.length < 2000) {
                  // Limit patch size
                  commitHistory += `- Changes:\n\`\`\`diff\n${file.patch}\n\`\`\`\n`;
                } else if (file.patch) {
                  commitHistory += `- Changes: [Large diff truncated - ${file.patch.length} characters]\n`;
                }
              });
            }
          }
        } catch (error) {
          console.error(
            `Error fetching commit details for ${commit.sha}:`,
            error
          );
          commitHistory += `**Note:** Could not fetch detailed changes for this commit\n`;
        }

        commitHistory += `\n---\n\n`;
      }

      const combinedContent = `${sourceCode}\n\n---\n\n${commitHistory}`;

      setRepoData({
        sourceCode,
        commitHistory,
        combinedContent,
      });

      toast({
        title: "Repository processed successfully",
        description: `Fetched ${commits.length} commits and processed source files`,
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

  const analyzeWithOpenAI = async () => {
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
      setAnalysis(
        "Error: Invalid API key format. Your OpenAI API key should start with 'sk-'."
      );
      return;
    }
    setIsProcessing(true);
    try {
      // Truncate content more aggressively to ensure it fits within API limits
      const maxContentLength = 50000; // Reduced from 100k to be safer
      let contentToAnalyze = repoData.combinedContent;

      console.log("Original content length:", contentToAnalyze.length);

      if (contentToAnalyze.length > maxContentLength) {
        contentToAnalyze =
          contentToAnalyze.substring(0, maxContentLength) +
          "\n\n[Content truncated due to size limits]";
        console.log("Content truncated to:", contentToAnalyze.length);
      }

      const requestBody = {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a senior software engineer and code reviewer. Analyze the provided repository code and commit history to give insights about the codebase, architecture, development patterns, and suggestions for improvement. Keep your response concise but comprehensive.",
          },
          {
            role: "user",
            content: `Please analyze this repository:\n\n${contentToAnalyze}`,
          },
        ],
        max_tokens: 3000, // Reduced to ensure response fits
        temperature: 0.7,
      };

      console.log(
        "Making OpenAI API request with payload size:",
        JSON.stringify(requestBody).length
      );

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

      console.log("OpenAI API response status:", response.status);

      if (!response.ok) {
        let errorMessage = `OpenAI API error: ${response.status}`;
        try {
          const errorData = await response.json();
          console.error("OpenAI API error details:", errorData);
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          console.error("Could not parse error response:", e);
        }
        setAnalysis(`Error: ${errorMessage}`);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("OpenAI API response received successfully");

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        setAnalysis("Error: Invalid response format from OpenAI API");
        throw new Error("Invalid response format from OpenAI API");
      }

      setAnalysis(data.choices[0].message.content);

      toast({
        title: "Analysis complete",
        description: "Repository has been analyzed by AI",
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
      // Error message is already set in setAnalysis above if API error, but set fallback here too
      if (!analysis) {
        setAnalysis(
          error instanceof Error
            ? `Error: ${error.message}`
            : "Error: Failed to analyze repository. Please check your API key and try again."
        );
      }
    } finally {
      setIsProcessing(false);
    }
  };

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
              <Button
                onClick={fetchRepoData}
                disabled={isProcessing}
                className="px-8"
              >
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
          </CardContent>
        </Card>

        {/* Results Section */}
        {repoData && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Combined Content */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Combined Content
                  <Badge variant="secondary">
                    {repoData.combinedContent.length} chars
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Source code and commit history combined
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={repoData.combinedContent}
                  readOnly
                  className="min-h-[400px] font-mono text-xs bg-code-bg border-code-border"
                />
                <div className="mt-4">
                  <Button
                    onClick={analyzeWithOpenAI}
                    disabled={isProcessing || !openaiKey.trim()}
                    className="w-full"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4 mr-2" />
                        Analyze with AI
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* AI Analysis */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bot className="h-5 w-5" />
                  AI Analysis
                </CardTitle>
                <CardDescription>
                  Insights and recommendations from OpenAI
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analysis ? (
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <pre className="whitespace-pre-wrap bg-code-bg p-4 rounded-lg border border-code-border text-sm">
                      {analysis}
                    </pre>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                    <div className="text-center">
                      <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>Click "Analyze with AI" to get insights</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default GitHubAnalyzer;
