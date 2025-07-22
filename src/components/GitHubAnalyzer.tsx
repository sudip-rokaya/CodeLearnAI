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
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Github, Bot, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CommitDiff {
  sha: string;
  message: string;
  diff: string;
  explanation?: string;
}

interface RepoData {
  diffs: CommitDiff[];
}

const GitHubAnalyzer = () => {
  const [repoUrl, setRepoUrl] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
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
      const commitsResponse = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?per_page=50`
      );

      if (!commitsResponse.ok) {
        throw new Error("Failed to fetch commit history");
      }

      const commits = await commitsResponse.json();

      const diffs: CommitDiff[] = [];

      for (const commit of commits) {
        try {
          const commitResponse = await fetch(
            `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${commit.sha}`
          );
          if (commitResponse.ok) {
            const commitDetails = await commitResponse.json();
            let diffText = "";
            if (commitDetails.files && commitDetails.files.length > 0) {
              commitDetails.files.forEach((file: any) => {
                if (file.patch) {
                  diffText += `### ${file.filename}\n\`\`\`diff\n${file.patch}\n\`\`\`\n`;
                }
              });
            }
            diffs.push({
              sha: commit.sha,
              message: commit.commit.message,
              diff: diffText,
            });
          }
        } catch (error) {
          console.error(
            `Error fetching commit details for ${commit.sha}:`,
            error
          );
        }
      }

      setRepoData({
        diffs,
      });

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

  const generateLesson = async (index: number) => {
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

      let contentToAnalyze = diff.diff;

      const requestBody = {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a technical educator. Provide a beginner-friendly explanation (at least 500 words) of the following code changes.",
          },
          {
            role: "user",
            content: contentToAnalyze,
          },
        ],
        max_tokens: 3000,
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
        throw new Error(errorMessage);
      }

      const data = await response.json();
      console.log("OpenAI API response received successfully");

      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error("Invalid response format from OpenAI API");
      }

      const newDiffs = [...repoData.diffs];
      newDiffs[index].explanation = data.choices[0].message.content;
      setRepoData({ diffs: newDiffs });

      toast({
        title: "Lesson generated",
        description: `Explanation created for commit ${diff.sha.substring(0, 7)}`,
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
      // Error message already shown via toast
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
          <div className="space-y-6">
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
      </div>
    </div>
  );
};

export default GitHubAnalyzer;
