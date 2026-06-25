import { useState } from "react";
import {
  BoldIcon,
  ItalicIcon,
  UnderlineIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  InfoIcon,
  TerminalIcon,
  SearchIcon,
  SettingsIcon,
  UserIcon,
  MailIcon,
  BellIcon,
  CalendarIcon,
  StarIcon,
  HeartIcon,
  CopyIcon,
} from "lucide-react";

import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{title}</h2>
      <div>{children}</div>
      <Separator />
    </section>
  );
}

export function GalleryView() {
  const [progress, setProgress] = useState(42);
  const [sliderVal, setSliderVal] = useState([50]);

  return (
    <TooltipProvider>
      <ScrollArea className="h-screen">
        <div className="p-6 flex flex-col gap-6 max-w-3xl mx-auto">
          <div>
            <h1 className="text-xl font-bold">shadcn/ui × VSCode Theme Gallery</h1>
            <p className="text-sm text-muted-foreground mt-1">
              All components themed to your active VSCode color scheme.
            </p>
          </div>

          {/* ── Buttons ── */}
          <Section title="Buttons">
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <Button size="sm">Small</Button>
              <Button size="lg">Large</Button>
              <Button size="icon"><StarIcon /></Button>
              <Button disabled>Disabled</Button>
            </div>
          </Section>

          {/* ── Badges ── */}
          <Section title="Badges">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="outline">Outline</Badge>
            </div>
          </Section>

          {/* ── Toggle & Toggle Group ── */}
          <Section title="Toggle & Toggle Group">
            <div className="flex flex-wrap items-center gap-3">
              <Toggle aria-label="Toggle bold"><BoldIcon /></Toggle>
              <Toggle variant="outline" aria-label="Toggle italic"><ItalicIcon /></Toggle>
              <Separator orientation="vertical" className="h-8" />
              <ToggleGroup type="multiple">
                <ToggleGroupItem value="bold" aria-label="Bold"><BoldIcon /></ToggleGroupItem>
                <ToggleGroupItem value="italic" aria-label="Italic"><ItalicIcon /></ToggleGroupItem>
                <ToggleGroupItem value="underline" aria-label="Underline"><UnderlineIcon /></ToggleGroupItem>
              </ToggleGroup>
            </div>
          </Section>

          {/* ── Avatar & Kbd ── */}
          <Section title="Avatar & Keyboard Shortcuts">
            <div className="flex flex-wrap items-center gap-4">
              <Avatar><AvatarFallback>SK</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>AI</AvatarFallback></Avatar>
              <Separator orientation="vertical" className="h-8" />
              <div className="flex items-center gap-1">
                <Kbd>⌘</Kbd><Kbd>K</Kbd>
              </div>
              <div className="flex items-center gap-1">
                <Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>P</Kbd>
              </div>
            </div>
          </Section>

          {/* ── Form Controls ── */}
          <Section title="Form Controls">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gallery-name">Text Input</Label>
                <Input id="gallery-name" placeholder="Enter your name..." />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gallery-email">With Icon</Label>
                <div className="relative">
                  <MailIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input id="gallery-email" placeholder="email@example.com" className="pl-9" />
                </div>
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="gallery-bio">Textarea</Label>
                <Textarea id="gallery-bio" placeholder="Tell us about yourself..." rows={3} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Select</Label>
                <Select>
                  <SelectTrigger><SelectValue placeholder="Choose..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="react">React</SelectItem>
                    <SelectItem value="vue">Vue</SelectItem>
                    <SelectItem value="svelte">Svelte</SelectItem>
                    <SelectItem value="angular">Angular</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="terms" />
                  <Label htmlFor="terms">Accept terms</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch id="notify" />
                  <Label htmlFor="notify">Notifications</Label>
                </div>
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label>Radio Group</Label>
                <RadioGroup defaultValue="option-1" className="flex gap-4">
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="option-1" id="r1" />
                    <Label htmlFor="r1">Option A</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="option-2" id="r2" />
                    <Label htmlFor="r2">Option B</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="option-3" id="r3" />
                    <Label htmlFor="r3">Option C</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>
          </Section>

          {/* ── Slider & Progress ── */}
          <Section title="Slider & Progress">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label>Slider — {sliderVal[0]}%</Label>
                <Slider value={sliderVal} onValueChange={setSliderVal} max={100} step={1} />
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <Label>Progress</Label>
                  <span className="text-xs text-muted-foreground">{progress}%</span>
                </div>
                <Progress value={progress} />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setProgress(Math.max(0, progress - 10))}>−10</Button>
                  <Button size="sm" variant="outline" onClick={() => setProgress(Math.min(100, progress + 10))}>+10</Button>
                </div>
              </div>
            </div>
          </Section>

          {/* ── Spinner & Skeleton ── */}
          <Section title="Spinner & Skeleton">
            <div className="flex items-center gap-6">
              <Spinner />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="h-12 w-12 rounded-full" />
            </div>
          </Section>

          {/* ── Cards ── */}
          <Section title="Cards">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle>Card Title</CardTitle>
                  <CardDescription>Card description text goes here.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">Content area themed to editor widget background.</p>
                </CardContent>
                <CardFooter className="flex justify-between">
                  <Button variant="outline" size="sm">Cancel</Button>
                  <Button size="sm">Save</Button>
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><BellIcon className="size-4" /> Notifications</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Push notifications</span>
                    <Switch />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Email digests</span>
                    <Switch defaultChecked />
                  </div>
                </CardContent>
              </Card>
            </div>
          </Section>

          {/* ── Tabs ── */}
          <Section title="Tabs">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="analytics">Analytics</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="p-3 text-sm">
                Overview tab content. Themed tabs follow button/accent colors.
              </TabsContent>
              <TabsContent value="analytics" className="p-3 text-sm">
                Analytics tab — charts would go here.
              </TabsContent>
              <TabsContent value="settings" className="p-3 text-sm">
                Settings tab — configuration forms here.
              </TabsContent>
            </Tabs>
          </Section>

          {/* ── Accordion ── */}
          <Section title="Accordion">
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="item-1">
                <AccordionTrigger>What is this gallery?</AccordionTrigger>
                <AccordionContent>
                  A showcase of all shadcn/ui components themed to your VSCode editor colors.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-2">
                <AccordionTrigger>How does theming work?</AccordionTrigger>
                <AccordionContent>
                  CSS variables in <code className="text-xs bg-muted px-1 rounded">styles.css</code> map
                  shadcn tokens to <code className="text-xs bg-muted px-1 rounded">var(--vscode-*)</code> values.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="item-3">
                <AccordionTrigger>Can I add more components?</AccordionTrigger>
                <AccordionContent>
                  Yes — run <code className="text-xs bg-muted px-1 rounded">npx shadcn add &lt;name&gt;</code> and they'll inherit the theme automatically.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </Section>

          {/* ── Collapsible ── */}
          <Section title="Collapsible">
            <Collapsible>
              <div className="flex items-center gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm">
                    <ChevronRightIcon className="size-4" />
                    3 items hidden
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent className="mt-2 space-y-1">
                <div className="rounded-md border px-3 py-2 text-sm">Item 1</div>
                <div className="rounded-md border px-3 py-2 text-sm">Item 2</div>
                <div className="rounded-md border px-3 py-2 text-sm">Item 3</div>
              </CollapsibleContent>
            </Collapsible>
          </Section>

          {/* ── Alerts ── */}
          <Section title="Alerts">
            <div className="flex flex-col gap-3">
              <Alert>
                <InfoIcon className="size-4" />
                <AlertTitle>Information</AlertTitle>
                <AlertDescription>This is a default alert styled with border colors.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <CircleAlertIcon className="size-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>Something went wrong. Themed with destructive colors.</AlertDescription>
              </Alert>
            </div>
          </Section>

          {/* ── Dialog & Alert Dialog ── */}
          <Section title="Dialog & Alert Dialog">
            <div className="flex gap-3">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Dialog Title</DialogTitle>
                    <DialogDescription>
                      This dialog is themed with popover/card colors from VSCode.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Input placeholder="Type something..." />
                  </div>
                  <DialogFooter>
                    <Button>Confirm</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Delete Item</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. This will permanently delete the item.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction>Continue</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Section>

          {/* ── Dropdown, Popover, HoverCard, Tooltip ── */}
          <Section title="Popover, Dropdown, HoverCard & Tooltip">
            <div className="flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline"><SettingsIcon className="size-4 mr-2" /> Dropdown</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem><CopyIcon className="size-4 mr-2" /> Copy</DropdownMenuItem>
                  <DropdownMenuItem><SearchIcon className="size-4 mr-2" /> Search</DropdownMenuItem>
                  <DropdownMenuItem><SettingsIcon className="size-4 mr-2" /> Settings</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline">Popover</Button>
                </PopoverTrigger>
                <PopoverContent className="w-64">
                  <div className="flex flex-col gap-2">
                    <h4 className="font-medium text-sm">Popover Content</h4>
                    <p className="text-xs text-muted-foreground">Themed with popover background.</p>
                    <Input placeholder="Search..." />
                  </div>
                </PopoverContent>
              </Popover>

              <HoverCard>
                <HoverCardTrigger asChild>
                  <Button variant="link">Hover Me</Button>
                </HoverCardTrigger>
                <HoverCardContent className="w-64">
                  <div className="flex items-center gap-3">
                    <Avatar><AvatarFallback>SK</AvatarFallback></Avatar>
                    <div>
                      <h4 className="text-sm font-semibold">Skynet</h4>
                      <p className="text-xs text-muted-foreground">AI-powered Scrum team</p>
                    </div>
                  </div>
                </HoverCardContent>
              </HoverCard>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon"><InfoIcon /></Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>This is a tooltip</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </Section>

          {/* ── Breadcrumb ── */}
          <Section title="Breadcrumb">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem><BreadcrumbLink href="#">Home</BreadcrumbLink></BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbLink href="#">Components</BreadcrumbLink></BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem><BreadcrumbPage>Gallery</BreadcrumbPage></BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </Section>

          {/* ── Table ── */}
          <Section title="Table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Component</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">Button</TableCell>
                  <TableCell>Actions</TableCell>
                  <TableCell><Badge>Installed</Badge></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Dialog</TableCell>
                  <TableCell>Overlay</TableCell>
                  <TableCell><Badge>Installed</Badge></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Tabs</TableCell>
                  <TableCell>Navigation</TableCell>
                  <TableCell><Badge variant="secondary">Themed</Badge></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">Calendar</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell><Badge variant="outline">Available</Badge></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Section>

          {/* ── Footer ── */}
          <div className="text-xs text-muted-foreground text-center pb-6">
            56 components installed · Switch VSCode themes to see colors update
          </div>
        </div>
      </ScrollArea>
    </TooltipProvider>
  );
}
