"use client";

import React, { useState, useRef, useEffect } from "react";
import { Send, Mic, MicOff, Power, Settings } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Modality,
  RTClient,
  RTInputAudioItem,
  RTResponse,
  TurnDetection,
} from "rt-client";
import { AudioHandler } from "@/lib/audio";

interface Message {
  type: "user" | "assistant" | "status";
  content: string;
}

interface ToolDeclaration {
  name: string;
  parameters: string;
  returnValue: string;
}

const ChatInterface = () => {
  // const [apiKey, setApiKey] = useState("");
  // const [endpoint, setEndpoint] = useState("");
  // const [deployment, setDeployment] = useState("gpt-4o-realtime-preview");
  const deployment = "gpt-4o-realtime-preview";
  const [useVAD, setUseVAD] = useState(true);
  const [instructions, setInstructions] = useState("You are an AI assistant that helps people find information.");
  const [temperature, setTemperature] = useState(0.9);
  const [modality, setModality] = useState("audio");
  // const [tools, setTools] = useState<ToolDeclaration[]>([]);
  const tools: ToolDeclaration[] = [];
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const clientRef = useRef<RTClient | null>(null);
  const audioHandlerRef = useRef<AudioHandler | null>(null);

  // const addTool = () => {
  //   setTools([...tools, { name: "", parameters: "", returnValue: "" }]);
  // };

  // const updateTool = (index: number, field: string, value: string) => {
  //   const newTools = [...tools];

  //   if (field === "name") {
  //     newTools[index].name = value;
  //   } else if (field === "parameters") {
  //     newTools[index].parameters = value;
  //   } else if (field === "returnValue") {
  //     newTools[index].returnValue = value;
  //   }
  // };

  const handleConnect = async () => {
    if (!isConnected) {
      try {
        setIsConnecting(true);
        clientRef.current = new RTClient(new URL(localStorage.getItem('endpoint') || ''), { key: localStorage.getItem('apiKey') || '' }, { deployment });
        const modalities: Modality[] =
          modality === "audio" ? ["text", "audio"] : ["text"];
        const turnDetection: TurnDetection = useVAD
          ? { type: "server_vad" }
          : null;
        clientRef.current.configure({
          instructions: instructions?.length > 0 ? instructions : undefined,
          input_audio_transcription: { model: "whisper-1" },
          turn_detection: turnDetection,
          tools,
          temperature,
          modalities,
        });
        startResponseListener();

        setIsConnected(true);
      } catch (error) {
        console.error("Connection failed:", error);
      } finally {
        setIsConnecting(false);
      }
    } else {
      await disconnect();
    }
  };

  const disconnect = async () => {
    if (clientRef.current) {
      try {
        await clientRef.current.close();
        clientRef.current = null;
        setIsConnected(false);
      } catch (error) {
        console.error("Disconnect failed:", error);
      }
    }
  };

  const handleResponse = async (response: RTResponse) => {
    for await (const item of response) {
      if (item.type === "message" && item.role === "assistant") {
        const message: Message = {
          type: item.role,
          content: "",
        };
        setMessages((prevMessages) => [...prevMessages, message]);
        for await (const content of item) {
          if (content.type === "text") {
            for await (const text of content.textChunks()) {
              message.content += text;
              setMessages((prevMessages) => {
                prevMessages[prevMessages.length - 1].content = message.content;
                return [...prevMessages];
              });
            }
          } else if (content.type === "audio") {
            const textTask = async () => {
              for await (const text of content.transcriptChunks()) {
                message.content += text;
                setMessages((prevMessages) => {
                  prevMessages[prevMessages.length - 1].content =
                    message.content;
                  return [...prevMessages];
                });
              }
            };
            const audioTask = async () => {
              audioHandlerRef.current?.startStreamingPlayback();
              for await (const audio of content.audioChunks()) {
                audioHandlerRef.current?.playChunk(audio);
              }
            };
            await Promise.all([textTask(), audioTask()]);
          }
        }
      }
    }
  };

  const handleInputAudio = async (item: RTInputAudioItem) => {
    audioHandlerRef.current?.stopStreamingPlayback();
    await item.waitForCompletion();
    setMessages((prevMessages) => [
      ...prevMessages,
      {
        type: "user",
        content: item.transcription || "",
      },
    ]);
  };

  const startResponseListener = async () => {
    if (!clientRef.current) return;

    try {
      for await (const serverEvent of clientRef.current.events()) {
        if (serverEvent.type === "response") {
          await handleResponse(serverEvent);
        } else if (serverEvent.type === "input_audio") {
          await handleInputAudio(serverEvent);
        }
      }
    } catch (error) {
      if (clientRef.current) {
        console.error("Response iteration error:", error);
      }
    }
  };

  const sendMessage = async () => {
    if (currentMessage.trim() && clientRef.current) {
      try {
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            type: "user",
            content: currentMessage,
          },
        ]);

        await clientRef.current.sendItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: currentMessage }],
        });
        await clientRef.current.generateResponse();
        setCurrentMessage("");
      } catch (error) {
        console.error("Failed to send message:", error);
      }
    }
  };

  const toggleRecording = async () => {
    if (!isRecording && clientRef.current) {
      try {
        if (!audioHandlerRef.current) {
          audioHandlerRef.current = new AudioHandler();
          await audioHandlerRef.current.initialize();
        }
        await audioHandlerRef.current.startRecording(async (chunk) => {
          await clientRef.current?.sendAudio(chunk);
        });
        setIsRecording(true);
      } catch (error) {
        console.error("Failed to start recording:", error);
      }
    } else if (audioHandlerRef.current) {
      try {
        audioHandlerRef.current.stopRecording();
        if (!useVAD) {
          const inputAudio = await clientRef.current?.commitAudio();
          await handleInputAudio(inputAudio!);
          await clientRef.current?.generateResponse();
        }
        setIsRecording(false);
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    }
  };

  useEffect(() => {
    const initAudioHandler = async () => {
      const handler = new AudioHandler();
      await handler.initialize();
      audioHandlerRef.current = handler;
    };

    initAudioHandler().catch(console.error);

    return () => {
      disconnect();
      audioHandlerRef.current?.close().catch(console.error);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen">
      {/* Parameters Panel */}
      <div className="" >
        <div className="flex items-center justify-center ">
          {/* <div className="">
            {tools.map((tool, index) => (
              <Card key={index} className="">
                <Input
                  placeholder="Function name"
                  value={tool.name}
                  onChange={(e) =>
                    updateTool(index, "name", e.target.value)
                  }
                  className="flex-1"
                  disabled={isConnected}
                />
                <Input
                  placeholder="Parameters"
                  value={tool.parameters}
                  onChange={(e) =>
                    updateTool(index, "parameters", e.target.value)
                  }
                  className="flex-1"
                  disabled={isConnected}
                />
                <Input
                  placeholder="Return value"
                  value={tool.returnValue}
                  className="flex-1"
                  onChange={(e) =>
                    updateTool(index, "returnValue", e.target.value)
                  }
                  disabled={isConnected}
                />
              </Card>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={addTool}
              className=""
              disabled={isConnected || true}
            >
              <Plus className="" />
              Tool
            </Button>
          </div> */}

          <div className="flex-1 m-2">
            <label className="text-sm font-medium">
              Temperature ({temperature})
            </label>
            <Slider
              value={[temperature]}
              onValueChange={([value]) => setTemperature(value)}
              min={0.6}
              max={1.2}
              step={0.1}
              disabled={isConnected}
            />
          </div>

          <div className="flex-2 m-2">
            <Select
              value={modality}
              onValueChange={setModality}
              disabled={isConnected}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-2 m-2">
            {/* <span>VAD</span> &nbsp; */}
            <Switch
              checked={useVAD}
              onCheckedChange={setUseVAD}
              disabled={isConnected}
            />
          </div>

          <div className="flex-2 m-2">
            <Button
              variant="default"
              onClick={() => {
                const azureK: string = prompt('') || '';
                if (azureK.indexOf('|') > 0) {
                  const azureK0 = azureK?.split('|')[0];
                  const azureK1 = azureK?.split('|')[1];
                  if (azureK0 && azureK1) {
                    localStorage.setItem('apiKey', azureK1);
                    localStorage.setItem('endpoint', azureK0);
                  }
                }
              }} >
              <Settings className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-2 m-2">
            <Button
              variant={isConnected ? "destructive" : "default"}
              onClick={handleConnect}
              disabled={isConnecting}
            >
              <Power className="w-4 h-4" />
              {/* {isConnecting
                ? "Connecting..."
                : isConnected
                  ? "Disconnect"
                  : "Connect"} */}
            </Button>
          </div>
        </div>
        <div className="w-full ">
          <textarea
            className="w-full border rounded"
            value={instructions}
            placeholder="Instructions"
            rows={2}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={isConnected}
          />
        </div>
      </div>

      {/* Chat Window */}
      <div className="flex-1 flex flex-col">
        {/* Messages Area */}
        <div className="flex-1 p-4 overflow-y-auto">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`mb-4 p-3 rounded-lg ${message.type === "user"
                ? "bg-blue-100 ml-auto max-w-[80%]"
                : "bg-gray-100 mr-auto max-w-[80%]"
                }`}
            >
              {message.content}
            </div>
          ))}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={currentMessage}
              onChange={(e) => setCurrentMessage(e.target.value)}
              placeholder="Type your message..."
              onKeyUp={(e) => e.key === "Enter" && sendMessage()}
              disabled={!isConnected}
            />
            <Button
              variant="outline"
              onClick={toggleRecording}
              className={isRecording ? "bg-red-100" : ""}
              disabled={!isConnected}
            >
              {isRecording ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>
            <Button onClick={sendMessage} disabled={!isConnected}>
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatInterface;
