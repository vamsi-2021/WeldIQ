require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "WeldScanner"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.license      = { :type => "UNLICENSED" }
  s.authors      = "WeldIQ"
  s.homepage     = "https://github.com/weldiq/weld-scanner"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/weldiq/weld-scanner.git", :tag => s.version.to_s }

  # Swift does the ARKit work; the .mm files are the React Native (TurboModule + Fabric) glue.
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.private_header_files = "ios/**/*.h"
  s.swift_version = "5.9"
  s.frameworks   = "ARKit", "AVFoundation", "SceneKit", "CoreImage", "ImageIO"
  s.pod_target_xcconfig = { "DEFINES_MODULE" => "YES" }

  install_modules_dependencies(s)
end
