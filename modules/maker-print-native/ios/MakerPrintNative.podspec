Pod::Spec.new do |s|
  s.name           = 'MakerPrintNative'
  s.version        = '0.1.0'
  s.summary        = 'Maker Print local module: exact print route, dry-run renderer, PDF page rasteriser (P4)'
  s.description    = 'Prints PDF pages 1:1 with an own UIPrintPageRenderer (D11) and rasterises PDF pages (D30).'
  s.license        = 'MIT'
  s.author         = 'Maker Print'
  s.homepage       = 'https://example.invalid/maker-print'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
