"use client";

import {
  Box,
  createSafeContext,
  factory,
  type BoxProps,
  type CompoundStylesApiProps,
  type ElementProps,
  type Factory,
  type GetStylesApi,
  type StylesApiProps,
  useProps,
  useStyles,
} from "@mantine/core";
import type { ReactNode } from "react";
import classes from "./KidScreen.module.css";

type KidScreenStylesNames = "root" | "header" | "content" | "actions" | "primary" | "secondary";

interface KidScreenContextValue {
  getStyles: GetStylesApi<KidScreenFactory>;
}

const [KidScreenProvider, useKidScreenContext] = createSafeContext<KidScreenContextValue>(
  "KidScreen sub-components must be rendered inside KidScreen",
);

export interface KidScreenProps extends BoxProps, StylesApiProps<KidScreenFactory>, ElementProps<"div"> {}

export interface KidScreenHeaderProps extends BoxProps, CompoundStylesApiProps<KidScreenHeaderFactory>, ElementProps<"div"> {}
export interface KidScreenContentProps extends BoxProps, CompoundStylesApiProps<KidScreenContentFactory>, ElementProps<"div"> {}
export interface KidScreenActionsProps extends BoxProps, CompoundStylesApiProps<KidScreenActionsFactory>, ElementProps<"div"> {
  secondary?: ReactNode;
}

export type KidScreenHeaderFactory = Factory<{
  props: KidScreenHeaderProps;
  ref: HTMLDivElement;
  stylesNames: KidScreenStylesNames;
  compound: true;
}>;

export type KidScreenContentFactory = Factory<{
  props: KidScreenContentProps;
  ref: HTMLDivElement;
  stylesNames: KidScreenStylesNames;
  compound: true;
}>;

export type KidScreenActionsFactory = Factory<{
  props: KidScreenActionsProps;
  ref: HTMLDivElement;
  stylesNames: KidScreenStylesNames;
  compound: true;
}>;

export type KidScreenFactory = Factory<{
  props: KidScreenProps;
  ref: HTMLDivElement;
  stylesNames: KidScreenStylesNames;
  staticComponents: {
    Header: typeof KidScreenHeader;
    Content: typeof KidScreenContent;
    Actions: typeof KidScreenActions;
  };
}>;

export const KidScreenHeader = factory<KidScreenHeaderFactory>((_props) => {
  const props = useProps("KidScreenHeader", {}, _props);
  const { className, style, classNames, styles, children, ...others } = props;
  const { getStyles } = useKidScreenContext();

  return <Box {...getStyles("header", { className, style, classNames, styles, props })} {...others}>{children}</Box>;
});
KidScreenHeader.displayName = "KidScreenHeader";

export const KidScreenContent = factory<KidScreenContentFactory>((_props) => {
  const props = useProps("KidScreenContent", {}, _props);
  const { className, style, classNames, styles, children, ...others } = props;
  const { getStyles } = useKidScreenContext();

  return <Box data-testid="kid-content" {...getStyles("content", { className, style, classNames, styles, props })} {...others}>{children}</Box>;
});
KidScreenContent.displayName = "KidScreenContent";

export const KidScreenActions = factory<KidScreenActionsFactory>((_props) => {
  const props = useProps("KidScreenActions", {}, _props);
  const { className, style, classNames, styles, children, secondary, ...others } = props;
  const { getStyles } = useKidScreenContext();

  return (
    <Box {...getStyles("actions", { className, style, classNames, styles, props })} {...others}>
      <Box data-testid="kid-primary-slot" {...getStyles("primary", { classNames, styles, props })}>{children}</Box>
      <Box data-testid="kid-secondary-slot" {...getStyles("secondary", { classNames, styles, props })}>{secondary}</Box>
    </Box>
  );
});
KidScreenActions.displayName = "KidScreenActions";

export const KidScreen = factory<KidScreenFactory>((_props) => {
  const props = useProps("KidScreen", {}, _props);
  const { classNames, className, style, styles, unstyled, vars, attributes, children, ...others } = props;
  const getStyles = useStyles<KidScreenFactory>({
    name: "KidScreen",
    classes,
    props,
    className,
    style,
    classNames,
    styles,
    unstyled,
    vars,
    attributes,
  });

  return (
    <KidScreenProvider value={{ getStyles }}>
      <Box data-testid="kid-screen" data-kid-screen="true" {...getStyles("root")} {...others}>
        {children}
      </Box>
    </KidScreenProvider>
  );
});

KidScreen.displayName = "KidScreen";
KidScreen.classes = classes;
KidScreen.Header = KidScreenHeader;
KidScreen.Content = KidScreenContent;
KidScreen.Actions = KidScreenActions;
