{
  description = "AnkiQuest gallery: development shell from AnkiQuest-Dev";

  # The toolchain and formatter come from AnkiQuest-Dev, where every
  # AnkiQuest repository's toolchain is pinned.
  inputs.ankiquest-dev.url = "github:AnkiQuest/AnkiQuest-Dev";

  outputs = {
    self,
    ankiquest-dev,
    ...
  }: {
    inherit (ankiquest-dev) formatter;

    devShells = builtins.mapAttrs (_: shells: {default = shells.gallery;}) ankiquest-dev.devShells;

    checks = ankiquest-dev.lib.formatChecks self;
  };
}
