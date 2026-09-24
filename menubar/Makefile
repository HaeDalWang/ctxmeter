# SwiftPM cannot emit a .app bundle, so the bundle is assembled here.
# Requires only Swift command line tools; full Xcode is not needed.

APP_NAME    := AgentLensBar
CONFIG      := release
BUILD_DIR   := .build/$(CONFIG)
BUNDLE      := $(BUILD_DIR)/$(APP_NAME).app
REPO_ROOT   := $(abspath ..)

.PHONY: all build test bundle run install clean

all: bundle

build:
	swift build -c $(CONFIG)

test:
	swift test

# Stages the Node CLI inside Resources so the app carries its own scanner.
bundle: build
	rm -rf "$(BUNDLE)"
	mkdir -p "$(BUNDLE)/Contents/MacOS" "$(BUNDLE)/Contents/Resources/agentlens"
	cp "$(BUILD_DIR)/$(APP_NAME)" "$(BUNDLE)/Contents/MacOS/$(APP_NAME)"
	sed 's|__DEFAULT_WORKSPACE__|$(REPO_ROOT)|' Info.plist > "$(BUNDLE)/Contents/Info.plist"
	cp -R "$(REPO_ROOT)/src" "$(BUNDLE)/Contents/Resources/agentlens/src"
	cp -R "$(REPO_ROOT)/config" "$(BUNDLE)/Contents/Resources/agentlens/config"
	cp "$(REPO_ROOT)/package.json" "$(BUNDLE)/Contents/Resources/agentlens/package.json"
	codesign --force --sign - "$(BUNDLE)" 2>/dev/null || \
		echo "note: ad-hoc signing unavailable; the app still runs locally"
	@echo "built $(BUNDLE)"

run: bundle
	open "$(BUNDLE)"

install: bundle
	rm -rf "/Applications/$(APP_NAME).app"
	cp -R "$(BUNDLE)" /Applications/
	@echo "installed /Applications/$(APP_NAME).app"

clean:
	rm -rf .build
