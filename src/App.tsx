import React from "react";
import { Init } from "./ui/Init.js";
import { Status } from "./ui/Status.js";
import { Watch } from "./ui/Watch.js";

type AppProps = {
  command: "init" | "status" | "watch";
};

export function App({ command }: AppProps) {
  switch (command) {
    case "init":
      return <Init />;
    case "status":
      return <Status />;
    case "watch":
      return <Watch />;
  }
}
