# Shell for developing the frontend
# Usage: nix develop -A frontend

{ nodejs_20 }:

{
  packages = [
    nodejs_20
    nodejs_20.pnpm
  ];
}
