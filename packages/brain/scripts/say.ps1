# Lee en voz alta el contenido de un archivo de texto usando la voz de
# Windows (SAPI5, System.Speech). El texto entra por archivo (no como
# argumento de linea de comandos) para no pelear con comillas/acentos.
param(
  [Parameter(Mandatory = $true)][string]$TextFile
)

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# Preferimos la primera voz en espanol instalada; si no hay ninguna,
# se queda con la voz por defecto del sistema.
$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'es*' } | Select-Object -First 1
if ($voice) {
  $synth.SelectVoice($voice.VoiceInfo.Name)
}

$text = Get-Content -Path $TextFile -Raw -Encoding UTF8
if ($text) {
  $synth.Speak($text)
}
